/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import querystring, { ParsedUrlQueryInput } from 'querystring';
import { emojiRegexAtStartToEnd } from '@/misc/emoji-regex.js';
import { getErrorData, MastodonLogger } from '@/server/api/mastodon/MastodonLogger.js';
import { parseTimelineArgs, TimelineArgs, toBoolean, toInt } from '@/server/api/mastodon/timelineArgs.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';
import { convertAttachment, convertPoll, MastoConverters } from '../converters.js';
import { getAccessToken, getClient, MastodonApiServerService } from '../MastodonApiServerService.js';
import type { Entity } from 'megalodon';
import type { FastifyInstance } from 'fastify';

function normalizeQuery(data: Record<string, unknown>) {
	const str = querystring.stringify(data as ParsedUrlQueryInput);
	return querystring.parse(str);
}

export class ApiStatusMastodon {
	constructor(
		private readonly fastify: FastifyInstance,
		private readonly mastoConverters: MastoConverters,
		private readonly logger: MastodonLogger,
		private readonly authenticateService: AuthenticateService,
		private readonly mastodon: MastodonApiServerService,
	) {}

	public getStatus() {
		this.fastify.get<{ Params: { id?: string } }>('/v1/statuses/:id', async (_request, reply) => {
			try {
				const { client, me } = await this.mastodon.getAuthClient(_request);
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.getStatus(_request.params.id);
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/statuses/${_request.params.id}`, data);
				reply.code(_request.is404 ? 404 : 401).send(data);
			}
		});
	}

	public getStatusSource() {
		this.fastify.get<{ Params: { id?: string } }>('/v1/statuses/:id/source', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.getStatusSource(_request.params.id);
				reply.send(data.data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/statuses/${_request.params.id}/source`, data);
				reply.code(_request.is404 ? 404 : 401).send(data);
			}
		});
	}

	public getContext() {
		this.fastify.get<{ Params: { id?: string }, Querystring: TimelineArgs }>('/v1/statuses/:id/context', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const { data } = await client.getStatusContext(_request.params.id, parseTimelineArgs(_request.query));
				const ancestors = await Promise.all(data.ancestors.map(async status => await this.mastoConverters.convertStatus(status, me)));
				const descendants = await Promise.all(data.descendants.map(async status => await this.mastoConverters.convertStatus(status, me)));
				reply.send({ ancestors, descendants });
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/statuses/${_request.params.id}/context`, data);
				reply.code(_request.is404 ? 404 : 401).send(data);
			}
		});
	}

	public getHistory() {
		this.fastify.get<{ Params: { id?: string } }>('/v1/statuses/:id/history', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const [user] = await this.authenticateService.authenticate(getAccessToken(_request.headers.authorization));
				const edits = await this.mastoConverters.getEdits(_request.params.id, user);
				reply.send(edits);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/statuses/${_request.params.id}/history`, data);
				reply.code(401).send(data);
			}
		});
	}

	public getReblogged() {
		this.fastify.get<{ Params: { id?: string } }>('/v1/statuses/:id/reblogged_by', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.getStatusRebloggedBy(_request.params.id);
				reply.send(await Promise.all(data.data.map(async (account: Entity.Account) => await this.mastoConverters.convertAccount(account))));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/statuses/${_request.params.id}/reblogged_by`, data);
				reply.code(401).send(data);
			}
		});
	}

	public getFavourites() {
		this.fastify.get<{ Params: { id?: string } }>('/v1/statuses/:id/favourited_by', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.getStatusFavouritedBy(_request.params.id);
				reply.send(await Promise.all(data.data.map(async (account: Entity.Account) => await this.mastoConverters.convertAccount(account))));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/statuses/${_request.params.id}/favourited_by`, data);
				reply.code(401).send(data);
			}
		});
	}

	public getMedia() {
		this.fastify.get<{ Params: { id?: string } }>('/v1/media/:id', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.getMedia(_request.params.id);
				reply.send(convertAttachment(data.data));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/media/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});
	}

	public getPoll() {
		this.fastify.get<{ Params: { id?: string } }>('/v1/polls/:id', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.getPoll(_request.params.id);
				reply.send(convertPoll(data.data));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/polls/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});
	}

	public votePoll() {
		this.fastify.post<{ Params: { id?: string }, Body: { choices?: number[] } }>('/v1/polls/:id/votes', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				if (!_request.body.choices) return reply.code(400).send({ error: 'Missing required payload "choices"' });
				const data = await client.votePoll(_request.params.id, _request.body.choices);
				reply.send(convertPoll(data.data));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/polls/${_request.params.id}/votes`, data);
				reply.code(401).send(data);
			}
		});
	}

	public postStatus() {
		this.fastify.post<{
			Body: {
				media_ids?: string[],
				poll?: {
					options?: string[],
					expires_in?: string,
					multiple?: string,
					hide_totals?: string,
				},
				in_reply_to_id?: string,
				sensitive?: string,
				spoiler_text?: string,
				visibility?: 'public' | 'unlisted' | 'private' | 'direct',
				scheduled_at?: string,
				language?: string,
				quote_id?: string,
				status?: string,

				// Broken clients
				'poll[options][]'?: string[],
				'media_ids[]'?: string[],
			}
		}>('/v1/statuses', async (_request, reply) => {
			let body = _request.body;
			try {
				const { client, me } = await this.mastodon.getAuthClient(_request);
				if ((!body.poll && body['poll[options][]']) || (!body.media_ids && body['media_ids[]'])
				) {
					body = normalizeQuery(body);
				}
				const text = body.status ??= ' ';
				const removed = text.replace(/@\S+/g, '').replace(/\s|/g, '');
				const isDefaultEmoji = emojiRegexAtStartToEnd.test(removed);
				const isCustomEmoji = /^:[a-zA-Z0-9@_]+:$/.test(removed);
				if ((body.in_reply_to_id && isDefaultEmoji) || (body.in_reply_to_id && isCustomEmoji)) {
					const a = await client.createEmojiReaction(
						body.in_reply_to_id,
						removed,
					);
					reply.send(a.data);
				}
				if (body.in_reply_to_id && removed === '/unreact') {
					const id = body.in_reply_to_id;
					const post = await client.getStatus(id);
					const react = post.data.emoji_reactions.filter(e => e.me)[0].name;
					const data = await client.deleteEmojiReaction(id, react);
					reply.send(data.data);
				}
				if (!body.media_ids) body.media_ids = undefined;
				if (body.media_ids && !body.media_ids.length) body.media_ids = undefined;

				if (body.poll && !body.poll.options) {
					return reply.code(400).send({ error: 'Missing required payload "poll.options"' });
				}
				if (body.poll && !body.poll.expires_in) {
					return reply.code(400).send({ error: 'Missing required payload "poll.expires_in"' });
				}

				const options = {
					...body,
					sensitive: toBoolean(body.sensitive),
					poll: body.poll ? {
						options: body.poll.options!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
						expires_in: toInt(body.poll.expires_in)!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
						multiple: toBoolean(body.poll.multiple),
						hide_totals: toBoolean(body.poll.hide_totals),
					} : undefined,
				};

				const data = await client.postStatus(text, options);
				reply.send(await this.mastoConverters.convertStatus(data.data as Entity.Status, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('POST /v1/statuses', data);
				reply.code(401).send(data);
			}
		});
	}

	public updateStatus() {
		this.fastify.put<{
			Params: { id: string },
			Body: {
				status?: string,
				spoiler_text?: string,
				sensitive?: string,
				media_ids?: string[],
				poll?: {
					options?: string[],
					expires_in?: string,
					multiple?: string,
					hide_totals?: string,
				},
			}
		}>('/v1/statuses/:id', async (_request, reply) => {
			try {
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const body = _request.body;

				if (!body.media_ids || !body.media_ids.length) {
					body.media_ids = undefined;
				}

				const options = {
					...body,
					sensitive: toBoolean(body.sensitive),
					poll: body.poll ? {
						options: body.poll.options,
						expires_in: toInt(body.poll.expires_in),
						multiple: toBoolean(body.poll.multiple),
						hide_totals: toBoolean(body.poll.hide_totals),
					} : undefined,
				};

				const data = await client.editStatus(_request.params.id, options);
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/statuses/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});
	}

	public addFavourite() {
		this.fastify.post<{ Params: { id?: string } }>('/v1/statuses/:id/favourite', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.createEmojiReaction(_request.params.id, '❤');
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/statuses/${_request.params.id}/favorite`, data);
				reply.code(401).send(data);
			}
		});
	}

	public rmFavourite() {
		this.fastify.post<{ Params: { id?: string } }>('/v1/statuses/:id/unfavourite', async (_request, reply) => {
			try {
				const { client, me } = await this.mastodon.getAuthClient(_request);
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.deleteEmojiReaction(_request.params.id, '❤');
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/statuses/${_request.params.id}/unfavorite`, data);
				reply.code(401).send(data);
			}
		});
	}

	public reblogStatus() {
		this.fastify.post<{ Params: { id?: string } }>('/v1/statuses/:id/reblog', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.reblogStatus(_request.params.id);
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/statuses/${_request.params.id}/reblog`, data);
				reply.code(401).send(data);
			}
		});
	}

	public unreblogStatus() {
		this.fastify.post<{ Params: { id?: string } }>('/v1/statuses/:id/unreblog', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.unreblogStatus(_request.params.id);
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/statuses/${_request.params.id}/unreblog`, data);
				reply.code(401).send(data);
			}
		});
	}

	public bookmarkStatus() {
		this.fastify.post<{ Params: { id?: string } }>('/v1/statuses/:id/bookmark', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.bookmarkStatus(_request.params.id);
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/statuses/${_request.params.id}/bookmark`, data);
				reply.code(401).send(data);
			}
		});
	}

	public unbookmarkStatus() {
		this.fastify.post<{ Params: { id?: string } }>('/v1/statuses/:id/unbookmark', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.unbookmarkStatus(_request.params.id);
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/statuses/${_request.params.id}/unbookmark`, data);
				reply.code(401).send(data);
			}
		});
	}

	public pinStatus() {
		this.fastify.post<{ Params: { id?: string } }>('/v1/statuses/:id/pin', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.pinStatus(_request.params.id);
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/statuses/${_request.params.id}/pin`, data);
				reply.code(401).send(data);
			}
		});
	}

	public unpinStatus() {
		this.fastify.post<{ Params: { id?: string } }>('/v1/statuses/:id/unpin', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.unpinStatus(_request.params.id);
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/statuses/${_request.params.id}/unpin`, data);
				reply.code(401).send(data);
			}
		});
	}

	public reactStatus() {
		this.fastify.post<{ Params: { id?: string, name?: string } }>('/v1/statuses/:id/react/:name', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				if (!_request.params.name) return reply.code(400).send({ error: 'Missing required parameter "name"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.createEmojiReaction(_request.params.id, _request.params.name);
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/statuses/${_request.params.id}/react/${_request.params.name}`, data);
				reply.code(401).send(data);
			}
		});
	}

	public unreactStatus() {
		this.fastify.post<{ Params: { id?: string, name?: string } }>('/v1/statuses/:id/unreact/:name', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				if (!_request.params.name) return reply.code(400).send({ error: 'Missing required parameter "name"' });
				const { client, me } = await this.mastodon.getAuthClient(_request);
				const data = await client.deleteEmojiReaction(_request.params.id, _request.params.name);
				reply.send(await this.mastoConverters.convertStatus(data.data, me));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/statuses/${_request.params.id}/unreact/${_request.params.name}`, data);
				reply.code(401).send(data);
			}
		});
	}

	public deleteStatus() {
		this.fastify.delete<{ Params: { id?: string } }>('/v1/statuses/:id', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.deleteStatus(_request.params.id);
				reply.send(data.data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`DELETE /v1/statuses/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});
	}
}
