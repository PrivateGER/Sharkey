/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { openAsBlob } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { promiseMap } from '@/misc/promise-map.js';
import { getErrorData, getErrorException, getErrorStatus, MastodonLogger } from '@/server/api/mastodon/MastodonLogger.js';
import { MastodonClientService } from '@/server/api/mastodon/MastodonClientService.js';
import { ApiAccountMastodon } from '@/server/api/mastodon/endpoints/account.js';
import { ApiAppsMastodon } from '@/server/api/mastodon/endpoints/apps.js';
import { ApiFilterMastodon } from '@/server/api/mastodon/endpoints/filter.js';
import { ApiInstanceMastodon } from '@/server/api/mastodon/endpoints/instance.js';
import { ApiStatusMastodon } from '@/server/api/mastodon/endpoints/status.js';
import { ApiNotificationsMastodon } from '@/server/api/mastodon/endpoints/notifications.js';
import { ApiTimelineMastodon } from '@/server/api/mastodon/endpoints/timeline.js';
import { ApiSearchMastodon } from '@/server/api/mastodon/endpoints/search.js';
import { ApiError } from '@/server/api/error.js';
import { ServerUtilityService } from '@/server/ServerUtilityService.js';
import { SkRateLimiterService } from '@/server/SkRateLimiterService.js';
import { getIpHash } from '@/misc/get-ip-hash.js';
import { sendRateLimitHeaders } from '@/misc/rate-limit-utils.js';
import type { BucketRateLimit, Keyed } from '@/misc/rate-limit-utils.js';
import { parseTimelineArgs, TimelineArgs, toBoolean } from './argsUtils.js';
import { convertAnnouncement, convertAttachment, MastodonConverters, convertRelationship } from './MastodonConverters.js';
import type { Entity } from 'megalodon';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';

// Mastodon's own budget: a burst of 300 requests that refills at 300 per 5 minutes.
// https://docs.joinmastodon.org/api/rate-limits/
const mastodonApiLimit: Keyed<BucketRateLimit> = {
	key: 'mastodon-api',
	type: 'bucket',
	size: 300,
	dripRate: 1000,
};

@Injectable()
export class MastodonApiServerService {
	constructor(
		private readonly mastoConverters: MastodonConverters,
		private readonly logger: MastodonLogger,
		private readonly clientService: MastodonClientService,
		private readonly apiAccountMastodon: ApiAccountMastodon,
		private readonly apiAppsMastodon: ApiAppsMastodon,
		private readonly apiFilterMastodon: ApiFilterMastodon,
		private readonly apiInstanceMastodon: ApiInstanceMastodon,
		private readonly apiNotificationsMastodon: ApiNotificationsMastodon,
		private readonly apiSearchMastodon: ApiSearchMastodon,
		private readonly apiStatusMastodon: ApiStatusMastodon,
		private readonly apiTimelineMastodon: ApiTimelineMastodon,
		private readonly serverUtilityService: ServerUtilityService,
		private readonly rateLimiterService: SkRateLimiterService,
	) {}

	@bindThis
	public createServer(fastify: FastifyInstance, _options: FastifyPluginOptions, done: (err?: Error) => void) {
		this.serverUtilityService.addMultipartFormDataContentType(fastify);
		this.serverUtilityService.addFormUrlEncodedContentType(fastify);
		this.serverUtilityService.addCORS(fastify);
		this.serverUtilityService.addFlattenedQueryType(fastify);

		// Convert JS exceptions into error responses
		fastify.setErrorHandler((error, request, reply) => {
			const data = getErrorData(error);
			const status = getErrorStatus(error);
			const exception = getErrorException(error);

			if (exception) {
				this.logger.exception(request, exception);
			}

			return reply.code(status).send(data);
		});

		// Log error responses (including converted JSON exceptions)
		fastify.addHook('onSend', (request, reply, payload, done) => {
			if (reply.statusCode >= 400) {
				if (typeof(payload) === 'string' && String(reply.getHeader('content-type')).toLowerCase().includes('application/json')) {
					const body = JSON.parse(payload);
					const data = getErrorData(body);
					this.logger.error(request, data, reply.statusCode);
				}
			}
			done();
		});

		fastify.addHook('onRequest', (request, reply, done) => {
			// Tell crawlers not to index API endpoints.
			// https://developers.google.com/search/docs/crawling-indexing/block-indexing
			reply.header('X-Robots-Tag', 'noindex');
			// Prevent cache
			reply.header('Cache-Control', 'private, max-age=0, must-revalidate');
			done();
		});

		// The native rate limits only apply once a handler calls back into the native API, which is after it has queried the database.
		// Those calls also arrive from this server, so the native limits can't tell unauthenticated clients apart.
		fastify.addHook('onRequest', async (request, reply) => {
			// A bad token is rejected by the handler; until then the client is limited by IP like any other anonymous one.
			const me = await this.clientService.getAuth(request).catch(() => null);
			const info = await this.rateLimiterService.limit(mastodonApiLimit, me ?? getIpHash(request.ip));

			sendRateLimitHeaders(reply, info);

			if (info.blocked) {
				throw new ApiError({
					message: 'Rate limit exceeded. Please try again later.',
					code: 'RATE_LIMIT_EXCEEDED',
					id: 'd5826d14-3982-4d2e-8011-b9e9f02499ef',
					httpStatusCode: 429,
				}, info);
			}
		});

		// External endpoints
		this.apiAccountMastodon.register(fastify);
		this.apiAppsMastodon.register(fastify);
		this.apiFilterMastodon.register(fastify);
		this.apiInstanceMastodon.register(fastify);
		this.apiNotificationsMastodon.register(fastify);
		this.apiSearchMastodon.register(fastify);
		this.apiStatusMastodon.register(fastify);
		this.apiTimelineMastodon.register(fastify);

		fastify.get('/v1/custom_emojis', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getInstanceCustomEmojis();
			return reply.send(data.data);
		});

		fastify.get('/v1/announcements', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getInstanceAnnouncements();
			const response = data.data.map((announcement) => convertAnnouncement(announcement));

			return reply.send(response);
		});

		fastify.post<{ Body: { id?: string } }>('/v1/announcements/:id/dismiss', async (_request, reply) => {
			if (!_request.body.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required payload "id"' });

			const client = this.clientService.getClient(_request);
			const data = await client.dismissInstanceAnnouncement(_request.body.id);

			return reply.send(data.data);
		});

		fastify.post<{ Body: { description?: string; focus?: string } }>('/v1/media', async (_request, reply) => {
			const multipartData = _request.savedRequestFiles?.[0];
			if (!multipartData) {
				return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'No image' });
			}

			const file = await readUpload(multipartData);
			const client = this.clientService.getClient(_request);
			const data = await client.uploadMedia(file, _request.body);
			const response = convertAttachment(data.data as Entity.Attachment);

			return reply.send(response);
		});

		fastify.post<{ Body: { description?: string; focus?: string } }>('/v2/media', async (_request, reply) => {
			const multipartData = _request.savedRequestFiles?.[0];
			if (!multipartData) {
				return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'No image' });
			}

			const file = await readUpload(multipartData);
			const client = this.clientService.getClient(_request);
			const data = await client.uploadMedia(file, _request.body);
			const response = convertAttachment(data.data as Entity.Attachment);

			return reply.send(response);
		});

		fastify.get('/v1/trends', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getInstanceTrends();
			return reply.send(data.data);
		});

		fastify.get('/v1/trends/tags', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getInstanceTrends();
			return reply.send(data.data);
		});

		fastify.get('/v1/trends/links', async (_request, reply) => {
			// As we do not have any system for news/links this will just return empty
			return reply.send([]);
		});

		fastify.get('/v1/preferences', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getPreferences();
			return reply.send(data.data);
		});

		fastify.get('/v1/followed_tags', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getFollowedTags();
			return reply.send(data.data);
		});

		fastify.get<{ Querystring: TimelineArgs }>('/v1/bookmarks', async (_request, reply) => {
			const { client, me } = await this.clientService.getAuthClient(_request);

			const data = await client.getBookmarks(parseTimelineArgs(_request.query));
			const response = await promiseMap(data.data, async (status) => await this.mastoConverters.convertStatus(status, me), { limiter: 4 });

			return reply.send(response);
		});

		fastify.get<{ Querystring: TimelineArgs }>('/v1/favourites', async (_request, reply) => {
			const { client, me } = await this.clientService.getAuthClient(_request);

			if (!me) {
				throw new ApiError({
					message: 'Credential required.',
					code: 'CREDENTIAL_REQUIRED',
					id: '1384574d-a912-4b81-8601-c7b1c4085df1',
					httpStatusCode: 401,
				});
			}

			const args = {
				...parseTimelineArgs(_request.query),
				userId: me.id,
			};
			const data = await client.getFavourites(args);
			const response = await promiseMap(data.data, async (status) => await this.mastoConverters.convertStatus(status, me), { limiter: 4 });

			return reply.send(response);
		});

		fastify.get<{ Querystring: TimelineArgs }>('/v1/mutes', async (_request, reply) => {
			const client = this.clientService.getClient(_request);

			const data = await client.getMutes(parseTimelineArgs(_request.query));
			const response = await promiseMap(data.data, async (account) => await this.mastoConverters.convertAccount(account), { limiter: 4 });

			return reply.send(response);
		});

		fastify.get<{ Querystring: TimelineArgs }>('/v1/blocks', async (_request, reply) => {
			const client = this.clientService.getClient(_request);

			const data = await client.getBlocks(parseTimelineArgs(_request.query));
			const response = await promiseMap(data.data, async (account) => await this.mastoConverters.convertAccount(account), { limiter: 4 });

			return reply.send(response);
		});

		fastify.get<{ Querystring: { limit?: string } }>('/v1/follow_requests', async (_request, reply) => {
			const client = this.clientService.getClient(_request);

			const limit = _request.query.limit ? parseInt(_request.query.limit) : 20;
			const data = await client.getFollowRequests(limit);
			const response = await promiseMap(data.data, async (account) => await this.mastoConverters.convertAccount(account), { limiter: 4 });

			return reply.send(response);
		});

		fastify.post<{ Params: { id?: string } }>('/v1/follow_requests/:id/authorize', async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });

			const client = this.clientService.getClient(_request);
			const data = await client.acceptFollowRequest(_request.params.id);
			const response = convertRelationship(data.data);

			return reply.send(response);
		});

		fastify.post<{ Params: { id?: string } }>('/v1/follow_requests/:id/reject', async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });

			const client = this.clientService.getClient(_request);
			const data = await client.rejectFollowRequest(_request.params.id);
			const response = convertRelationship(data.data);

			return reply.send(response);
		});
		//#endregion

		fastify.post<{
			Body: {
				account_id?: string,
				status_ids?: string | string[],
				'status_ids[]'?: string | string[],
				comment?: string,
				category?: string,
			},
		}>('/v1/reports', async (_request, reply) => {
			const body = _request.body;
			if (!body.account_id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required payload "account_id"' });

			const client = this.clientService.getClient(_request);
			const account = await client.getAccount(body.account_id);
			const data = await client.report(body.account_id, {
				comment: body.comment ?? '',
				category: body.category === 'spam' || body.category === 'violation' ? body.category : 'other',
				status_ids: [body.status_ids ?? body['status_ids[]'] ?? []].flat(),
			});
			const response = {
				...data.data,
				created_at: new Date().toISOString(),
				target_account: await this.mastoConverters.convertAccount(account.data),
			};

			return reply.send(response);
		});

		fastify.put<{
			Params: {
				id?: string,
			},
			Body: {
				file?: unknown,
				description?: string,
				focus?: string,
				is_sensitive?: string,
			},
		}>('/v1/media/:id', async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });

			const options = {
				..._request.body,
				is_sensitive: toBoolean(_request.body.is_sensitive),
			};
			const client = this.clientService.getClient(_request);
			const data = await client.updateMedia(_request.params.id, options);
			const response = convertAttachment(data.data);

			return reply.send(response);
		});

		done();
	}
}

/**
 * Loads an upload from the temporary file that the multipart hook stored it in.
 * The upload's own stream is spent by then, so reading it from the part yields nothing.
 */
async function readUpload(upload: NonNullable<FastifyRequest['savedRequestFiles']>[number]): Promise<File> {
	const blob = await openAsBlob(upload.filepath, { type: upload.mimetype });
	return new File([blob], upload.filename || 'file', { type: upload.mimetype });
}
