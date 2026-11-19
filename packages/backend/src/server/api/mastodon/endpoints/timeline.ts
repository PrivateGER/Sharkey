/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MastodonClientService } from '@/server/api/mastodon/MastodonClientService.js';
import { RegistryApiService } from '@/core/RegistryApiService.js';
import { TimeService } from '@/global/TimeService.js';
import type { MiLocalUser } from '@/models/User.js';
import { ApiError } from '@/server/api/error.js';
import { ServerUtilityService } from '@/server/ServerUtilityService.js';
import { attachMinMaxPagination } from '@/server/api/mastodon/pagination.js';
import { promiseMap } from '@/misc/promise-map.js';
import { convertList, MastodonConverters } from '../MastodonConverters.js';
import { parseTimelineArgs, TimelineArgs, toBoolean } from '../argsUtils.js';
import type { Entity } from 'megalodon';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const markerTimelines = ['home', 'notifications'] as const;
type MarkerTimeline = typeof markerTimelines[number];

interface Marker {
	last_read_id: string;
	version: number;
	updated_at: string;
}

// Markers are kept in the user's registry under a domain of their own.
// The native registry API keeps a separate one per app, but a read position is meant to follow the user from app to app.
const markerDomain = 'mastodon';
const markerScope = ['markers'];

@Injectable()
export class ApiTimelineMastodon {
	constructor(
		private readonly clientService: MastodonClientService,
		private readonly mastoConverters: MastodonConverters,
		private readonly registryApiService: RegistryApiService,
		private readonly timeService: TimeService,
		private readonly serverUtilityService: ServerUtilityService,
	) {}

	public register(fastify: FastifyInstance): void {
		fastify.get<{ Querystring: TimelineArgs }>('/v1/timelines/public', async (request, reply) => {
			const { client, me } = await this.clientService.getAuthClient(request);
			const query = parseTimelineArgs(request.query);
			const data = toBoolean(request.query.local)
				? await client.getLocalTimeline(query)
				: await client.getPublicTimeline(query);
			const response = await promiseMap(data.data, async (status: Entity.Status) => await this.mastoConverters.convertStatus(status, me), { limiter: 4 });

			attachMinMaxPagination(request, reply, response);
			return reply.send(response);
		});

		fastify.get<{ Querystring: TimelineArgs }>('/v1/timelines/home', async (request, reply) => {
			const { client, me } = await this.clientService.getAuthClient(request);
			const query = parseTimelineArgs(request.query);
			const data = await client.getHomeTimeline(query);
			const response = await promiseMap(data.data, async (status: Entity.Status) => await this.mastoConverters.convertStatus(status, me), { limiter: 4 });

			attachMinMaxPagination(request, reply, response);
			return reply.send(response);
		});

		fastify.get<{ Params: { hashtag?: string }, Querystring: TimelineArgs }>('/v1/timelines/tag/:hashtag', async (request, reply) => {
			if (!request.params.hashtag) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "hashtag"' });

			const { client, me } = await this.clientService.getAuthClient(request);
			const query = parseTimelineArgs(request.query);
			const data = await client.getTagTimeline(request.params.hashtag, query);
			const response = await promiseMap(data.data, async (status: Entity.Status) => await this.mastoConverters.convertStatus(status, me), { limiter: 4 });

			attachMinMaxPagination(request, reply, response);
			return reply.send(response);
		});

		fastify.get<{ Params: { id?: string }, Querystring: TimelineArgs }>('/v1/timelines/list/:id', async (request, reply) => {
			if (!request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });

			const { client, me } = await this.clientService.getAuthClient(request);
			const query = parseTimelineArgs(request.query);
			const data = await client.getListTimeline(request.params.id, query);
			const response = await promiseMap(data.data, async (status: Entity.Status) => await this.mastoConverters.convertStatus(status, me), { limiter: 4 });

			attachMinMaxPagination(request, reply, response);
			return reply.send(response);
		});

		fastify.get<{ Querystring: TimelineArgs }>('/v1/conversations', async (request, reply) => {
			const { client, me } = await this.clientService.getAuthClient(request);
			const query = parseTimelineArgs(request.query);
			const data = await client.getConversationTimeline(query);
			const response = await promiseMap(data.data, async (conversation: Entity.Conversation) => await this.mastoConverters.convertConversation(conversation, me), { limiter: 4 });

			attachMinMaxPagination(request, reply, response);
			return reply.send(response);
		});

		fastify.get<{ Params: { id?: string } }>('/v1/lists/:id', async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });

			const client = this.clientService.getClient(_request);
			const data = await client.getList(_request.params.id);
			const response = convertList(data.data);

			return reply.send(response);
		});

		fastify.get('/v1/lists', async (request, reply) => {
			const client = this.clientService.getClient(request);
			const data = await client.getLists();
			const response = data.data.map((list: Entity.List) => convertList(list));

			attachMinMaxPagination(request, reply, response);
			return reply.send(response);
		});

		fastify.get<{ Params: { id?: string }, Querystring: TimelineArgs }>('/v1/lists/:id/accounts', async (request, reply) => {
			if (!request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });

			const client = this.clientService.getClient(request);
			const data = await client.getAccountsInList(request.params.id, parseTimelineArgs(request.query));
			const response = await promiseMap(data.data, async (account: Entity.Account) => await this.mastoConverters.convertAccount(account), { limiter: 4 });

			attachMinMaxPagination(request, reply, response);
			return reply.send(response);
		});

		fastify.post<{ Params: { id?: string }, Querystring: { accounts_id?: string[] } }>('/v1/lists/:id/accounts', async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });
			if (!_request.query.accounts_id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required property "accounts_id"' });

			const client = this.clientService.getClient(_request);
			const data = await client.addAccountsToList(_request.params.id, _request.query.accounts_id);

			return reply.send(data.data);
		});

		fastify.delete<{ Params: { id?: string }, Querystring: { accounts_id?: string[] } }>('/v1/lists/:id/accounts', async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });
			if (!_request.query.accounts_id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required property "accounts_id"' });

			const client = this.clientService.getClient(_request);
			const data = await client.deleteAccountsFromList(_request.params.id, _request.query.accounts_id);

			return reply.send(data.data);
		});

		fastify.post<{ Body: { title?: string } }>('/v1/lists', async (_request, reply) => {
			if (!_request.body.title) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required payload "title"' });

			const client = this.clientService.getClient(_request);
			const data = await client.createList(_request.body.title);
			const response = convertList(data.data);

			return reply.send(response);
		});

		fastify.put<{ Params: { id?: string }, Body: { title?: string } }>('/v1/lists/:id', async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });
			if (!_request.body.title) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required payload "title"' });

			const client = this.clientService.getClient(_request);
			const data = await client.updateList(_request.params.id, _request.body.title);
			const response = convertList(data.data);

			return reply.send(response);
		});

		fastify.delete<{ Params: { id?: string } }>('/v1/lists/:id', async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });

			const client = this.clientService.getClient(_request);
			await client.deleteList(_request.params.id);

			return reply.send({});
		});

		fastify.get<{ Querystring: { timeline?: string | string[] } }>('/v1/markers', async (request, reply) => {
			const me = await this.authorize(request, 'read:account');

			const requested = [request.query.timeline ?? []].flat();
			const response: Partial<Record<MarkerTimeline, Marker>> = {};
			for (const timeline of markerTimelines) {
				if (!requested.includes(timeline)) continue;

				const item = await this.registryApiService.getItem(me.id, markerDomain, markerScope, timeline);
				if (item) response[timeline] = item.value;
			}

			return reply.send(response);
		});

		fastify.post<{ Body?: Record<string, { last_read_id?: unknown } | string | undefined> }>('/v1/markers', async (request, reply) => {
			const me = await this.authorize(request, 'write:account');

			const response: Partial<Record<MarkerTimeline, Marker>> = {};
			for (const timeline of markerTimelines) {
				// JSON bodies nest the ID, form bodies arrive with the brackets still in the key.
				const nested = request.body?.[timeline];
				const lastReadId = typeof nested === 'object' ? nested.last_read_id : request.body?.[`${timeline}[last_read_id]`];
				if (typeof lastReadId !== 'string' || lastReadId === '') continue;

				const previous = await this.registryApiService.getItem(me.id, markerDomain, markerScope, timeline);
				const marker: Marker = {
					last_read_id: lastReadId,
					version: typeof previous?.value?.version === 'number' ? previous.value.version + 1 : 0,
					updated_at: this.timeService.date.toISOString(),
				};
				await this.registryApiService.set(me.id, markerDomain, markerScope, timeline, marker);
				response[timeline] = marker;
			}

			return reply.send(response);
		});
	}

	/**
	 * Gets the user of a request, who must be signed in with an account in good standing and through an app that has the permission.
	 * These routes store data themselves, so the native API is not there to check any of that.
	 */
	private async authorize(request: FastifyRequest, permission: string): Promise<MiLocalUser> {
		const { me, token } = await this.clientService.getAuthWithToken(request);

		const accountError = this.serverUtilityService.assertClientUser(me);
		if (accountError || !me) {
			throw new ApiError(accountError);
		}

		if (token && !token.permission.includes(permission)) {
			throw new ApiError({
				message: 'Your app does not have the necessary permissions to use this endpoint.',
				code: 'PERMISSION_DENIED',
				kind: 'permission',
				id: '1370e5b7-d4eb-4566-bb1d-7748ee6a1838',
				httpStatusCode: 403,
			});
		}

		return me;
	}
}
