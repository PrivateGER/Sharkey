/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MastodonClientService } from '@/server/api/mastodon/MastodonClientService.js';
import type { FastifyInstance } from 'fastify';

@Injectable()
export class ApiFilterMastodon {
	constructor(
		private readonly clientService: MastodonClientService,
	) {}

	public register(fastify: FastifyInstance): void {
		// Filters are not supported, so every account has none.
		// Clients load this list when they start, and an empty one lets them carry on.
		for (const path of ['/v1/filters', '/v2/filters']) {
			fastify.get(path, async (request, reply) => {
				const me = await this.clientService.getAuth(request);
				if (!me) {
					return reply.code(401).send({ error: 'The access token is invalid' });
				}

				return reply.send([]);
			});
		}
	}
}
