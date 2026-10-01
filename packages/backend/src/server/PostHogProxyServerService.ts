/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import fastifyProxy from '@fastify/http-proxy';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { postHogProxyPath } from '@/core/PostHogService.js';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

// Anything else the browser sends (cookies, Authorization, Sharkey session headers) must not reach PostHog.
const forwardedRequestHeaders = ['accept', 'accept-encoding', 'accept-language', 'content-encoding', 'content-length', 'content-type', 'user-agent'];

/**
 * Relays browser analytics through the instance's own origin, so blocklists that match PostHog's domains do not drop it.
 */
@Injectable()
export class PostHogProxyServerService {
	constructor(
		@Inject(DI.config)
		private config: Config,
	) {}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		if (!this.config.posthog) {
			done();
			return;
		}

		// posthog-js posts gzip bytes as text/plain; Fastify's built-in text parser would decode them
		// as UTF-8 and the forwarded body would no longer match Content-Length. This plugin scope only
		// contains the proxy, which overrides JSON and `*` itself but not text/plain.
		fastify.addContentTypeParser('text/plain', (request, payload, parserDone) => parserDone(null, payload));

		const upstream = new URL(this.config.posthog.host);
		fastify.register(fastifyProxy, {
			upstream: upstream.origin,
			prefix: postHogProxyPath,
			rewritePrefix: upstream.pathname.replace(/\/$/, ''),
			httpMethods: ['GET', 'POST'],
			replyOptions: {
				rewriteRequestHeaders: (request, headers) => {
					const forwarded: Record<string, string | string[] | undefined> = { host: headers.host };
					for (const name of forwardedRequestHeaders) {
						if (headers[name] !== undefined) forwarded[name] = headers[name];
					}
					// PostHog derives GeoIP from this; without it every visitor would appear to be at the server.
					forwarded['x-forwarded-for'] = request.ip;
					return forwarded;
				},
				rewriteHeaders: (headers) => {
					const { 'set-cookie': _, ...rest } = headers;
					return rest;
				},
			},
		});

		done();
	}
}
