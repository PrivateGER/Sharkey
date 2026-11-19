/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MastodonClientService } from '@/server/api/mastodon/MastodonClientService.js';
import { attachMinMaxPagination, attachOffsetPagination } from '@/server/api/mastodon/pagination.js';
import { promiseMap } from '@/misc/promise-map.js';
import { MastodonConverters } from '../MastodonConverters.js';
import { parseTimelineArgs, TimelineArgs, toBoolean, toInt } from '../argsUtils.js';
import type { FastifyInstance } from 'fastify';
import type { Entity } from 'megalodon';

interface ApiSearchMastodonRoute {
	Querystring: TimelineArgs & {
		type?: string;
		q?: string;
		resolve?: string;
	}
}

@Injectable()
export class ApiSearchMastodon {
	constructor(
		private readonly mastoConverters: MastodonConverters,
		private readonly clientService: MastodonClientService,
	) {}

	public register(fastify: FastifyInstance): void {
		fastify.get<ApiSearchMastodonRoute>('/v1/search', async (request, reply) => {
			if (!request.query.q) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required property "q"' });
			if (!request.query.type) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required property "type"' });

			const type = request.query.type;
			if (type !== 'hashtags' && type !== 'statuses' && type !== 'accounts') {
				return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Invalid type' });
			}

			const { client, me } = await this.clientService.getAuthClient(request);

			if (toBoolean(request.query.resolve) && !me) {
				return reply.code(401).send({ error: 'The access token is invalid', error_description: 'Authentication is required to use the "resolve" property' });
			}
			if (toInt(request.query.offset) && !me) {
				return reply.code(401).send({ error: 'The access token is invalid', error_description: 'Authentication is required to use the "offset" property' });
			}

			// TODO implement resolve

			const query = parseTimelineArgs(request.query);
			const { data } = await client.search(request.query.q, { type, ...query });
			const response = {
				...data,
				accounts: await promiseMap(data.accounts, (account: Entity.Account) => this.mastoConverters.convertAccount(account), { limiter: 3 }),
				statuses: await promiseMap(data.statuses, (status: Entity.Status) => this.mastoConverters.convertStatus(status, me), { limiter: 3 }),
			};

			if (type === 'hashtags') {
				attachOffsetPagination(request, reply, response.hashtags);
			} else {
				attachMinMaxPagination(request, reply, response[type]);
			}

			return reply.send(response);
		});

		fastify.get<ApiSearchMastodonRoute>('/v2/search', async (request, reply) => {
			if (!request.query.q) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required property "q"' });

			const type = request.query.type;
			if (type !== undefined && type !== 'hashtags' && type !== 'statuses' && type !== 'accounts') {
				return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Invalid type' });
			}

			const { client, me } = await this.clientService.getAuthClient(request);

			if (toBoolean(request.query.resolve) && !me) {
				return reply.code(401).send({ error: 'The access token is invalid', error_description: 'Authentication is required to use the "resolve" property' });
			}
			if (toInt(request.query.offset) && !me) {
				return reply.code(401).send({ error: 'The access token is invalid', error_description: 'Authentication is required to use the "offset" property' });
			}

			// TODO implement resolve

			const query = parseTimelineArgs(request.query);
			const acct = !type || type === 'accounts' ? await client.search(request.query.q, { type: 'accounts', ...query }) : null;
			const stat = !type || type === 'statuses' ? await client.search(request.query.q, { type: 'statuses', ...query }) : null;
			const tags = !type || type === 'hashtags' ? await client.search(request.query.q, { type: 'hashtags', ...query }) : null;
			const response = {
				accounts: acct ? await promiseMap(acct.data.accounts, async (account: Entity.Account) => await this.mastoConverters.convertAccount(account), { limiter: 3 }) : [],
				statuses: acct ? await promiseMap(acct.data.statuses, async (status: Entity.Status) => this.mastoConverters.convertStatus(status, me), { limiter: 3 }) : [],
				hashtags: tags?.data.hashtags ?? [],
			};

			// Pagination hack, based on "best guess" expected behavior.
			// Mastodon doesn't document this part at all!
			const longestResult = [response.statuses, response.hashtags]
				.reduce((longest: unknown[], current: unknown[]) => current.length > longest.length ? current : longest, response.accounts);

			// Ignore min/max pagination because how TF would that work with multiple result sets??
			// Offset pagination is the only possible option
			attachOffsetPagination(request, reply, longestResult);

			return reply.send(response);
		});

		fastify.get<ApiSearchMastodonRoute>('/v1/trends/statuses', async (request, reply) => {
			const { client, me } = await this.clientService.getAuthClient(request);
			const data = await client.getTrendingStatuses();
			const response = await promiseMap(data.data, async status => await this.mastoConverters.convertStatus(status, me), { limiter: 4 });

			attachMinMaxPagination(request, reply, response);
			return reply.send(response);
		});

		fastify.get<ApiSearchMastodonRoute>('/v2/suggestions', async (request, reply) => {
			const client = this.clientService.getClient(request);
			const { limit, offset } = parseTimelineArgs(request.query);
			const data = await client.getPopularAccounts({ limit, offset });
			const response = await promiseMap(data.data, async entry => ({
				source: 'global',
				account: await this.mastoConverters.convertAccount(entry),
			}), {
				limiter: 4,
			});

			attachOffsetPagination(request, reply, response);
			return reply.send(response);
		});
	}
}
