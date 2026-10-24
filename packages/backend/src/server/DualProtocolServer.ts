/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as net from 'node:net';
import type { Duplex } from 'node:stream';

/**
 * Every HTTP/2 connection starts with this fixed client connection preface (RFC 9113 section 3.4).
 * HTTP/1.x requests start with a method token instead, so the first bytes tell the two apart.
 */
const HTTP2_PREFACE = Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n', 'latin1');

export type DualProtocolRequestHandler = (
	request: http.IncomingMessage | http2.Http2ServerRequest,
	response: http.ServerResponse | http2.Http2ServerResponse,
) => void;

/**
 * Tuning options. The HTTP/1 and HTTP/2 fields have the same names and meaning as Fastify's server options, so the
 * options object Fastify hands to its serverFactory can be passed through as-is (Fastify skips applying them itself
 * when a serverFactory is used).
 */
export interface DualProtocolServerOptions {
	/** Hard limit (ms) for a new connection to send enough bytes to tell its protocol; silent or trickling clients are dropped. */
	prefaceTimeout?: number;
	/** Passed to http.createServer (for example headersTimeout or connectionsCheckingInterval). */
	http?: http.ServerOptions;
	/** Passed to http2.createServer. */
	http2?: http2.ServerOptions;
	/** http.Server#keepAliveTimeout. */
	keepAliveTimeout?: number;
	/** http.Server#requestTimeout. */
	requestTimeout?: number;
	/** http.Server#timeout / http2.Http2Server#timeout, applied through setTimeout(). */
	connectionTimeout?: number;
	/** http.Server#maxRequestsPerSocket; 0 means unlimited. */
	maxRequestsPerSocket?: number;
	/** How long (ms) an HTTP/2 session may stay idle before it is closed. */
	http2SessionTimeout?: number;
}

/**
 * Cleartext server that accepts HTTP/1.1 and HTTP/2 (h2c) on the same port.
 *
 * Node's plain Http2Server only speaks h2c: it has no protocol negotiation and it never emits the HTTP/1 `upgrade`
 * event that WebSocket handshakes rely on. This server peeks at the first bytes of every connection and hands it to
 * an internal http.Server or http2.Http2Server, so `protocol: http2` keeps the `/streaming` WebSocket working and
 * keeps serving HTTP/1.1 clients and proxies.
 *
 * `upgrade` and `clientError` events from the HTTP/1 side are re-emitted here, so consumers can treat this object
 * like the http.Server that Fastify would otherwise expose.
 */
export class DualProtocolServer extends net.Server {
	public readonly http1Server: http.Server;
	public readonly http2Server: http2.Http2Server;

	private readonly prefaceTimeout: number;
	private readonly pendingSockets = new Set<net.Socket>();
	private readonly http2Sessions = new Set<http2.ServerHttp2Session>();

	constructor(handler: DualProtocolRequestHandler, options: DualProtocolServerOptions = {}) {
		super();

		this.prefaceTimeout = options.prefaceTimeout ?? 30_000;
		const http2SessionTimeout = options.http2SessionTimeout ?? 72_000;

		this.http1Server = http.createServer(options.http ?? {}, handler as http.RequestListener);
		this.http2Server = http2.createServer(options.http2 ?? {}, handler as (request: http2.Http2ServerRequest, response: http2.Http2ServerResponse) => void);

		// Same tuning Fastify applies to the servers it creates itself.
		this.http1Server.keepAliveTimeout = options.keepAliveTimeout ?? 72_000;
		this.http1Server.requestTimeout = options.requestTimeout ?? 0;
		this.http1Server.setTimeout(options.connectionTimeout ?? 0);
		this.http2Server.setTimeout(options.connectionTimeout ?? 0);
		if (options.maxRequestsPerSocket != null && options.maxRequestsPerSocket > 0) {
			this.http1Server.maxRequestsPerSocket = options.maxRequestsPerSocket;
		}

		// The inner servers never listen themselves, but http.Server sets up its connection tracking (which drives
		// headersTimeout, requestTimeout and closeIdleConnections) from its own 'listening' event, so relay ours.
		this.on('listening', () => {
			this.http1Server.emit('listening');
			this.http2Server.emit('listening');
		});

		this.http1Server.on('upgrade', (request: http.IncomingMessage, socket: Duplex, head: Buffer) => {
			if (this.listenerCount('upgrade') === 0) {
				// Same as Node's behaviour for an http.Server without upgrade listeners.
				socket.destroy();
				return;
			}
			this.emit('upgrade', request, socket, head);
		});

		this.http1Server.on('clientError', (error: NodeJS.ErrnoException, socket: Duplex) => {
			if (this.listenerCount('clientError') > 0) {
				this.emit('clientError', error, socket);
				return;
			}

			// Replicates Node's default handling, which is skipped as soon as any listener is attached.
			if (error.code === 'ECONNRESET' || !socket.writable) {
				socket.destroy();
				return;
			}
			const status =
				error.code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large' :
				error.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? '408 Request Timeout' :
				'400 Bad Request';
			socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
		});

		this.http2Server.on('session', (session: http2.ServerHttp2Session) => {
			this.http2Sessions.add(session);
			session.once('close', () => this.http2Sessions.delete(session));
			session.setTimeout(http2SessionTimeout, () => session.close());
		});

		this.on('connection', this.sniffProtocol);
	}

	public override close(callback?: (err?: Error) => void): this {
		// Stops http.Server's connection-checking interval; it is not listening, so ignore its "not running" error.
		this.http1Server.close(() => { /* noop */ });
		return super.close(callback);
	}

	/**
	 * Closes connections that are not serving a request, like http.Server#closeIdleConnections.
	 * Fastify calls this during a graceful shutdown. HTTP/2 sessions are all asked to close, which is graceful too:
	 * they send GOAWAY, finish their open streams and then disconnect.
	 */
	public closeIdleConnections(): void {
		this.http1Server.closeIdleConnections();
		for (const session of this.http2Sessions) {
			session.close();
		}
		for (const socket of this.pendingSockets) {
			socket.destroy();
		}
	}

	/**
	 * Forcibly closes every connection, like http.Server#closeAllConnections.
	 */
	public closeAllConnections(): void {
		this.http1Server.closeAllConnections();
		for (const session of this.http2Sessions) {
			session.destroy();
		}
		for (const socket of this.pendingSockets) {
			socket.destroy();
		}
	}

	private readonly sniffProtocol = (socket: net.Socket): void => {
		const chunks: Buffer[] = [];
		let buffered = 0;
		const deadline = process.hrtime.bigint() + BigInt(this.prefaceTimeout) * 1_000_000n;

		const cleanup = () => {
			socket.setTimeout(0);
			socket.off('timeout', onTimeout);
			socket.off('data', onData);
			socket.off('error', onError);
			socket.off('close', cleanup);
			this.pendingSockets.delete(socket);
		};

		const dispatch = (target: net.Server, resume: boolean) => {
			socket.pause();
			cleanup();
			// Give the sniffed bytes back so that the real protocol parser sees the whole stream.
			socket.unshift(Buffer.concat(chunks, buffered));
			target.emit('connection', socket);
			// http.Server reads through 'data' events, so the paused socket has to be resumed for it.
			// Http2Server takes over the socket handle and drains the readable buffer itself on the next tick,
			// so it must NOT be resumed: flowing mode would emit the preface to nobody and lose it.
			if (resume) socket.resume();
		};

		const onData = (chunk: Buffer) => {
			chunks.push(chunk);
			buffered += chunk.length;

			const head = Buffer.concat(chunks, buffered).subarray(0, HTTP2_PREFACE.length);
			if (!head.equals(HTTP2_PREFACE.subarray(0, head.length))) {
				dispatch(this.http1Server, true);
			} else if (head.length === HTTP2_PREFACE.length) {
				dispatch(this.http2Server, false);
			} else {
				// A prefix of the HTTP/2 preface: wait for more bytes, but only until the original deadline.
				// socket.setTimeout() is an idle timeout that every byte resets, so re-arm it with the time left.
				const remainingMs = Number((deadline - process.hrtime.bigint()) / 1_000_000n);
				if (remainingMs <= 0) {
					onTimeout();
				} else {
					socket.setTimeout(remainingMs);
				}
			}
		};

		// Nobody can be told about errors before the protocol is known; just drop the connection.
		const onError = () => cleanup();

		const onTimeout = () => {
			cleanup();
			socket.destroy();
		};

		this.pendingSockets.add(socket);
		socket.setTimeout(this.prefaceTimeout);
		socket.on('timeout', onTimeout);
		socket.on('data', onData);
		socket.on('error', onError);
		socket.on('close', cleanup);
	};
}
