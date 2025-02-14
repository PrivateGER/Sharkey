/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getErrorData, MastodonLogger } from '@/server/api/mastodon/MastodonLogger.js';
import { convertList, MastoConverters } from '../converters.js';
import { getClient, MastodonApiServerService } from '../MastodonApiServerService.js';
import { parseTimelineArgs, TimelineArgs, toBoolean } from '../timelineArgs.js';
import type { Entity } from 'megalodon';
import type { FastifyInstance } from 'fastify';

export class ApiTimelineMastodon {
	constructor(
		private readonly fastify: FastifyInstance,
		private readonly mastoConverters: MastoConverters,
		private readonly logger: MastodonLogger,
		private readonly mastodon: MastodonApiServerService,
	) {}

	public getTL() {
		this.fastify.get<{ Querystring: TimelineArgs }>('/v1/timelines/public', async (_request, reply) => {
			try {
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = toBoolean(_request.query.local)
					? await client.getLocalTimeline(parseTimelineArgs(_request.query))
					: await client.getPublicTimeline(parseTimelineArgs(_request.query));
				reply.send(await Promise.all(data.data.map(async (status: Entity.Status) => await this.mastoConverters.convertStatus(status, me))));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/timelines/public', data);
				reply.code(401).send(data);
			}
		});
	}

	public getHomeTl() {
		this.fastify.get<{ Querystring: TimelineArgs }>('/v1/timelines/home', async (_request, reply) => {
			try {
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.getHomeTimeline(parseTimelineArgs(_request.query));
				reply.send(await Promise.all(data.data.map(async (status: Entity.Status) => await this.mastoConverters.convertStatus(status, me))));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/timelines/home', data);
				reply.code(401).send(data);
			}
		});
	}

	public getTagTl() {
		this.fastify.get<{ Params: { hashtag?: string }, Querystring: TimelineArgs }>('/v1/timelines/tag/:hashtag', async (_request, reply) => {
			try {
				if (!_request.params.hashtag) return reply.code(400).send({ error: 'Missing required parameter "hashtag"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.getTagTimeline(_request.params.hashtag, parseTimelineArgs(_request.query));
				reply.send(await Promise.all(data.data.map(async (status: Entity.Status) => await this.mastoConverters.convertStatus(status, me))));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/timelines/tag/${_request.params.hashtag}`, data);
				reply.code(401).send(data);
			}
		});
	}

	public getListTL() {
		this.fastify.get<{ Params: { id?: string }, Querystring: TimelineArgs }>('/v1/timelines/list/:id', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.getListTimeline(_request.params.id, parseTimelineArgs(_request.query));
				reply.send(await Promise.all(data.data.map(async (status: Entity.Status) => await this.mastoConverters.convertStatus(status, me))));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/timelines/list/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});
	}

	public getConversations() {
		this.fastify.get<{ Querystring: TimelineArgs }>('/v1/conversations', async (_request, reply) => {
			try {
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.getConversationTimeline(parseTimelineArgs(_request.query));
				const conversations = await Promise.all(data.data.map(async (conversation: Entity.Conversation) => await this.mastoConverters.convertConversation(conversation, me)));
				reply.send(conversations);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/conversations', data);
				reply.code(401).send(data);
			}
		});
	}

	public getList() {
		this.fastify.get<{ Params: { id?: string } }>('/v1/lists/:id', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const BASE_URL = `${_request.protocol}://${_request.host}`;
				const accessTokens = _request.headers.authorization;
				const client = getClient(BASE_URL, accessTokens);
				const data = await client.getList(_request.params.id);
				reply.send(convertList(data.data));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/lists/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});
	}

	public getLists() {
		this.fastify.get('/v1/lists', async (_request, reply) => {
			try {
				const BASE_URL = `${_request.protocol}://${_request.host}`;
				const accessTokens = _request.headers.authorization;
				const client = getClient(BASE_URL, accessTokens);
				const data = await client.getLists();
				reply.send(data.data.map((list: Entity.List) => convertList(list)));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/lists', data);
				reply.code(401).send(data);
			}
		});
	}

	public getListAccounts() {
		this.fastify.get<{ Params: { id?: string }, Querystring: { limit?: number, max_id?: string, since_id?: string } }>('/v1/lists/:id/accounts', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const BASE_URL = `${_request.protocol}://${_request.host}`;
				const accessTokens = _request.headers.authorization;
				const client = getClient(BASE_URL, accessTokens);
				const data = await client.getAccountsInList(_request.params.id, _request.query);
				const accounts = await Promise.all(data.data.map((account: Entity.Account) => this.mastoConverters.convertAccount(account)));
				reply.send(accounts);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/lists/${_request.params.id}/accounts`, data);
				reply.code(401).send(data);
			}
		});
	}

	public addListAccount() {
		this.fastify.post<{ Params: { id?: string }, Querystring: { accounts_id?: string[] } }>('/v1/lists/:id/accounts', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				if (!_request.query.accounts_id) return reply.code(400).send({ error: 'Missing required property "accounts_id"' });
				const BASE_URL = `${_request.protocol}://${_request.host}`;
				const accessTokens = _request.headers.authorization;
				const client = getClient(BASE_URL, accessTokens);
				const data = await client.addAccountsToList(_request.params.id, _request.query.accounts_id);
				reply.send(data.data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/lists/${_request.params.id}/accounts`, data);
				reply.code(401).send(data);
			}
		});
	}

	public rmListAccount() {
		this.fastify.delete<{ Params: { id?: string }, Querystring: { accounts_id?: string[] } }>('/v1/lists/:id/accounts', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				if (!_request.query.accounts_id) return reply.code(400).send({ error: 'Missing required property "accounts_id"' });
				const BASE_URL = `${_request.protocol}://${_request.host}`;
				const accessTokens = _request.headers.authorization;
				const client = getClient(BASE_URL, accessTokens);
				const data = await client.deleteAccountsFromList(_request.params.id, _request.query.accounts_id);
				reply.send(data.data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`DELETE /v1/lists/${_request.params.id}/accounts`, data);
				reply.code(401).send(data);
			}
		});
	}

	public createList() {
		this.fastify.post<{ Body: { title?: string } }>('/v1/lists', async (_request, reply) => {
			try {
				if (!_request.body.title) return reply.code(400).send({ error: 'Missing required payload "title"' });
				const BASE_URL = `${_request.protocol}://${_request.host}`;
				const accessTokens = _request.headers.authorization;
				const client = getClient(BASE_URL, accessTokens);
				const data = await client.createList(_request.body.title);
				reply.send(convertList(data.data));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('POST /v1/lists', data);
				reply.code(401).send(data);
			}
		});
	}

	public updateList() {
		this.fastify.put<{ Params: { id?: string }, Body: { title?: string } }>('/v1/lists/:id', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				if (!_request.body.title) return reply.code(400).send({ error: 'Missing required payload "title"' });
				const BASE_URL = `${_request.protocol}://${_request.host}`;
				const accessTokens = _request.headers.authorization;
				const client = getClient(BASE_URL, accessTokens);
				const data = await client.updateList(_request.params.id, _request.body.title);
				reply.send(convertList(data.data));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`PUT /v1/lists/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});
	}

	public deleteList() {
		this.fastify.delete<{ Params: { id?: string } }>('/v1/lists/:id', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const BASE_URL = `${_request.protocol}://${_request.host}`;
				const accessTokens = _request.headers.authorization;
				const client = getClient(BASE_URL, accessTokens);
				await client.deleteList(_request.params.id);
				reply.send({});
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`DELETE /v1/lists/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});
	}
}
