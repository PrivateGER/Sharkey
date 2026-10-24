/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as net from 'node:net';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { DualProtocolServer } from '@/server/DualProtocolServer.js';
import type { FastifyInstance } from 'fastify';

const HTTP2_PREFACE = 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n';

async function listen(server: net.Server): Promise<number> {
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return (server.address() as net.AddressInfo).port;
}

async function rawExchange(port: number, payload: string | Buffer, waitMs = 200): Promise<{ data: string, closed: boolean }> {
	const socket = net.connect(port, '127.0.0.1');
	await once(socket, 'connect');
	socket.write(payload);
	let data = '';
	let closed = false;
	socket.on('data', chunk => data += chunk.toString('latin1'));
	socket.on('close', () => closed = true);
	await sleep(waitMs);
	socket.destroy();
	return { data, closed };
}

async function http1Get(port: number, path = '/'): Promise<{ status: number, body: string }> {
	return await new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port, path }, res => {
			let body = '';
			res.setEncoding('utf8');
			res.on('data', chunk => body += chunk);
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
		}).on('error', reject);
	});
}

async function h2cGet(port: number, path = '/'): Promise<{ status: number, body: string }> {
	const session = http2.connect(`http://127.0.0.1:${port}`);
	try {
		return await new Promise((resolve, reject) => {
			session.on('error', reject);
			const req = session.request({ ':path': path });
			let status = 0;
			let body = '';
			req.on('response', headers => status = Number(headers[':status']));
			req.setEncoding('utf8');
			req.on('data', chunk => body += chunk);
			req.on('end', () => resolve({ status, body }));
			req.on('error', reject);
			req.end();
		});
	} finally {
		session.close();
	}
}

describe(DualProtocolServer, () => {
	describe('behind Fastify', () => {
		let fastify: FastifyInstance<http2.Http2Server, http2.Http2ServerRequest, http2.Http2ServerResponse>;
		let server: DualProtocolServer;
		let port: number;

		beforeAll(async () => {
			fastify = Fastify({
				http2: true,
				serverFactory: handler => {
					server = new DualProtocolServer(handler, { prefaceTimeout: 300 });
					return server as unknown as http2.Http2Server;
				},
			});
			fastify.get('/hello', async (request) => `hello over ${request.raw.httpVersion}`);
			await fastify.ready();
			port = await listen(fastify.server);
		});

		afterAll(async () => {
			await fastify.close();
		});

		test('serves HTTP/1.1 requests', async () => {
			const res = await http1Get(port, '/hello');
			expect(res.status).toBe(200);
			expect(res.body).toBe('hello over 1.1');
		});

		test('serves h2c requests', async () => {
			const res = await h2cGet(port, '/hello');
			expect(res.status).toBe(200);
			expect(res.body).toBe('hello over 2.0');
		});

		test('serves both protocols concurrently on the same port', async () => {
			const results = await Promise.all([
				h2cGet(port, '/hello'),
				http1Get(port, '/hello'),
				h2cGet(port, '/hello'),
				http1Get(port, '/hello'),
			]);
			expect(results.map(r => r.body)).toEqual(['hello over 2.0', 'hello over 1.1', 'hello over 2.0', 'hello over 1.1']);
		});

		test('routes an HTTP/2 preface that arrives in pieces to the HTTP/2 server', async () => {
			const sessionSeen = once(server.http2Server, 'session');
			const socket = net.connect(port, '127.0.0.1');
			await once(socket, 'connect');
			socket.write(HTTP2_PREFACE.slice(0, 10));
			await sleep(50);
			socket.write(HTTP2_PREFACE.slice(10));
			// An empty SETTINGS frame completes the client side of the handshake.
			socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]));

			await expect(Promise.race([sessionSeen, sleep(1000).then(() => { throw new Error('no session'); })])).resolves.toBeDefined();
			socket.destroy();
		});

		test('hands HTTP/1.1 upgrade requests to upgrade listeners on the Fastify server', async () => {
			const onUpgrade = (request: http.IncomingMessage, socket: net.Socket) => {
				socket.end(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: ${request.headers.upgrade}\r\nConnection: Upgrade\r\n\r\n`);
			};
			fastify.server.on('upgrade', onUpgrade);
			try {
				const { data } = await rawExchange(port, 'GET /streaming HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
				expect(data).toMatch(/^HTTP\/1\.1 101 Switching Protocols\r\n/);
				expect(data).toContain('Upgrade: websocket');
			} finally {
				fastify.server.off('upgrade', onUpgrade);
			}
		});

		test('drops upgrade requests when nobody listens for them', async () => {
			const { data, closed } = await rawExchange(port, 'GET /streaming HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
			expect(data).toBe('');
			expect(closed).toBe(true);
		});

		test('answers malformed HTTP/1 input with 400 like a plain http.Server', async () => {
			const { data, closed } = await rawExchange(port, 'this is not http\r\n\r\n');
			expect(data).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/);
			expect(closed).toBe(true);
		});

		test('does not misroute input that merely starts like the HTTP/2 preface', async () => {
			// "PRI" is the start of the preface, but the rest is not, so this must reach the HTTP/1 parser.
			const { data } = await rawExchange(port, 'PRI * HTTP/1.1\r\nHost: localhost\r\n\r\n');
			expect(data).toMatch(/^HTTP\/1\.1 4\d\d /);
		});

		test('drops connections that stay silent past the preface timeout', async () => {
			const socket = net.connect(port, '127.0.0.1');
			await once(socket, 'connect');
			const closed = once(socket, 'close');
			await expect(Promise.race([closed, sleep(2000).then(() => { throw new Error('still open'); })])).resolves.toBeDefined();
		});
	});

	describe('limits', () => {
		test('drops a client that trickles the HTTP/2 preface one byte at a time past the deadline', async () => {
			const server = new DualProtocolServer((request, response) => response.end('ok'), { prefaceTimeout: 300 });
			const port = await listen(server);
			try {
				const socket = net.connect(port, '127.0.0.1');
				await once(socket, 'connect');
				let closedAfterMs = -1;
				const started = Date.now();
				socket.on('close', () => closedAfterMs = Date.now() - started);
				socket.on('error', () => { /* reset by the server is expected */ });
				// Each byte would reset a plain idle timeout; the deadline must still fire at about 300ms.
				for (let i = 0; i < 12 && closedAfterMs < 0; i++) {
					socket.write(HTTP2_PREFACE[i]);
					await sleep(100);
				}
				expect(closedAfterMs).toBeGreaterThan(0);
				expect(closedAfterMs).toBeLessThan(900);
			} finally {
				await new Promise<void>(resolve => server.close(() => resolve()));
			}
		});

		test('serves HTTP/1.1 and h2c over a UNIX socket', async () => {
			const server = new DualProtocolServer((request, response) => response.end(`via ${request.httpVersion}`));
			// UNIX socket paths are limited to about 100 bytes, so keep it short.
			const socketPath = join(tmpdir(), `sharkey-dual-${process.pid}.sock`);
			rmSync(socketPath, { force: true });
			server.listen(socketPath);
			await once(server, 'listening');
			try {
				const h1 = await new Promise<string>((resolve, reject) => {
					http.get({ socketPath, path: '/' }, res => {
						let body = '';
						res.setEncoding('utf8');
						res.on('data', chunk => body += chunk);
						res.on('end', () => resolve(body));
					}).on('error', reject);
				});
				expect(h1).toBe('via 1.1');

				const session = http2.connect('http://localhost', { createConnection: () => net.connect(socketPath) });
				try {
					const h2 = await new Promise<string>((resolve, reject) => {
						session.on('error', reject);
						const req = session.request({ ':path': '/' });
						let body = '';
						req.setEncoding('utf8');
						req.on('data', chunk => body += chunk);
						req.on('end', () => resolve(body));
						req.on('error', reject);
						req.end();
					});
					expect(h2).toBe('via 2.0');
				} finally {
					session.close();
				}
			} finally {
				await new Promise<void>(resolve => server.close(() => resolve()));
				rmSync(socketPath, { force: true });
			}
		});

		test('enforces headersTimeout on HTTP/1 connections like a plain http.Server', async () => {
			const server = new DualProtocolServer((request, response) => response.end('ok'), {
				http: { headersTimeout: 200, connectionsCheckingInterval: 50 },
			});
			const port = await listen(server);
			try {
				// Start a request but never finish the headers.
				const { data, closed } = await rawExchange(port, 'GET / HTTP/1.1\r\nHost: localhost\r\nX-Slow: ', 1000);
				expect(data).toMatch(/^HTTP\/1\.1 408 Request Timeout\r\n/);
				expect(closed).toBe(true);
			} finally {
				await new Promise<void>(resolve => server.close(() => resolve()));
			}
		});

		test('applies the keep-alive and request timeouts it is given to the HTTP/1 server', () => {
			const server = new DualProtocolServer((request, response) => response.end('ok'), {
				keepAliveTimeout: 1234,
				requestTimeout: 5678,
				maxRequestsPerSocket: 9,
			});
			expect(server.http1Server.keepAliveTimeout).toBe(1234);
			expect(server.http1Server.requestTimeout).toBe(5678);
			expect(server.http1Server.maxRequestsPerSocket).toBe(9);
			server.close();
		});
	});

	describe('shutdown', () => {
		test('closeIdleConnections ends keep-alive HTTP/1 connections and idle HTTP/2 sessions', async () => {
			const server = new DualProtocolServer((request, response) => response.end('ok'));
			const port = await listen(server);

			const agent = new http.Agent({ keepAlive: true });
			await new Promise<void>((resolve, reject) => {
				http.get({ host: '127.0.0.1', port, path: '/', agent }, res => {
					res.resume();
					res.on('end', resolve);
				}).on('error', reject);
			});
			const session = http2.connect(`http://127.0.0.1:${port}`);
			await once(session, 'connect');
			const sessionClosed = once(session, 'close');

			// Let the server finish bookkeeping for the completed HTTP/1 response before asking for idle connections to go.
			await sleep(50);
			const started = Date.now();
			server.closeIdleConnections();
			await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
			await expect(Promise.race([sessionClosed, sleep(2000).then(() => { throw new Error('session still open'); })])).resolves.toBeDefined();
			// Without closeIdleConnections, close() would wait for the keep-alive socket to time out (5s by default).
			expect(Date.now() - started).toBeLessThan(2000);

			agent.destroy();
		});
	});
});
