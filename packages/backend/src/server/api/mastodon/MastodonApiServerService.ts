/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import querystring from 'querystring';
import multer from 'fastify-multer';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { Config } from '@/config.js';
import { getErrorData, getErrorStatus, MastodonLogger } from '@/server/api/mastodon/MastodonLogger.js';
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
import { parseTimelineArgs, TimelineArgs, toBoolean } from './argsUtils.js';
import { convertAnnouncement, convertAttachment, MastodonConverters, convertRelationship } from './MastodonConverters.js';
import type { Entity } from 'megalodon';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

@Injectable()
export class MastodonApiServerService {
	constructor(
		@Inject(DI.config)
		private readonly config: Config,

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
	) {}

	@bindThis
	public createServer(fastify: FastifyInstance, _options: FastifyPluginOptions, done: (err?: Error) => void) {
		const upload = multer({
			storage: multer.diskStorage({}),
			limits: {
				fileSize: this.config.maxFileSize || 262144000,
				files: 1,
			},
		});

		fastify.addHook('onRequest', (_, reply, done) => {
			// Allow web-based clients to connect from other origins.
			reply.header('Access-Control-Allow-Origin', '*');

			// Mastodon uses all types of request methods.
			reply.header('Access-Control-Allow-Methods', '*');

			// Allow web-based clients to access Link header - required for mastodon pagination.
			// https://stackoverflow.com/a/54928828
			// https://docs.joinmastodon.org/api/guidelines/#pagination
			// https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Expose-Headers
			reply.header('Access-Control-Expose-Headers', 'Link');

			// Cache to avoid extra pre-flight requests
			// https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Max-Age
			reply.header('Access-Control-Max-Age', 60 * 60 * 24); // 1 day in seconds

			done();
		});

		fastify.addContentTypeParser('application/x-www-form-urlencoded', (_, payload, done) => {
			let body = '';
			payload.on('data', (data) => {
				body += data;
			});
			payload.on('end', () => {
				try {
					const parsed = querystring.parse(body);
					done(null, parsed);
				} catch (e) {
					done(e as Error);
				}
			});
			payload.on('error', done);
		});

		// Remove trailing "[]" from query params
		fastify.addHook('preValidation', (request, _reply, done) => {
			if (!request.query || typeof(request.query) !== 'object') {
				return done();
			}

			// Same object aliased with a different type
			const query = request.query as Record<string, string | string[] | undefined>;

			for (const key of Object.keys(query)) {
				if (!key.endsWith('[]')) {
					continue;
				}
				if (query[key] == null) {
					continue;
				}

				const newKey = key.substring(0, key.length - 2);
				const newValue = query[key];
				const oldValue = query[newKey];

				// Move the value to the correct key
				if (oldValue != null) {
					if (Array.isArray(oldValue)) {
						// Works for both array and single values
						query[newKey] = oldValue.concat(newValue);
					} else if (Array.isArray(newValue)) {
						// Preserve order
						query[newKey] = [oldValue, ...newValue];
					} else {
						// Preserve order
						query[newKey] = [oldValue, newValue];
					}
				} else {
					query[newKey] = newValue;
				}

				// Remove the invalid key
				delete query[key];
			}

			return done();
		});

		fastify.setErrorHandler((error, request, reply) => {
			const data = getErrorData(error);
			const status = getErrorStatus(error);

			this.logger.error(request, data, status);

			reply.code(status).send(data);
		});

		fastify.register(multer.contentParser);

		// External endpoints
		this.apiAccountMastodon.register(fastify, upload);
		this.apiAppsMastodon.register(fastify, upload);
		this.apiFilterMastodon.register(fastify, upload);
		this.apiInstanceMastodon.register(fastify);
		this.apiNotificationsMastodon.register(fastify, upload);
		this.apiSearchMastodon.register(fastify);
		this.apiStatusMastodon.register(fastify);
		this.apiTimelineMastodon.register(fastify);

		fastify.get('/v1/custom_emojis', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getInstanceCustomEmojis();
			reply.send(data.data);
		});

		fastify.get('/v1/announcements', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getInstanceAnnouncements();
			const response = data.data.map((announcement) => convertAnnouncement(announcement));

			reply.send(response);
		});

		fastify.post<{ Body: { id?: string } }>('/v1/announcements/:id/dismiss', async (_request, reply) => {
			if (!_request.body.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required payload "id"' });

			const client = this.clientService.getClient(_request);
			const data = await client.dismissInstanceAnnouncement(_request.body.id);

			reply.send(data.data);
		});

		fastify.post('/v1/media', { preHandler: upload.single('file') }, async (_request, reply) => {
			const multipartData = await _request.file();
			if (!multipartData) {
				reply.code(401).send({ error: 'No image' });
				return;
			}

			const client = this.clientService.getClient(_request);
			const data = await client.uploadMedia(multipartData);
			const response = convertAttachment(data.data as Entity.Attachment);

			reply.send(response);
		});

		fastify.post<{ Body: { description?: string; focus?: string }}>('/v2/media', { preHandler: upload.single('file') }, async (_request, reply) => {
			const multipartData = await _request.file();
			if (!multipartData) {
				reply.code(401).send({ error: 'No image' });
				return;
			}

			const client = this.clientService.getClient(_request);
			const data = await client.uploadMedia(multipartData, _request.body);
			const response = convertAttachment(data.data as Entity.Attachment);

			reply.send(response);
		});

		fastify.get('/v1/trends', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getInstanceTrends();
			reply.send(data.data);
		});

		fastify.get('/v1/trends/tags', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getInstanceTrends();
			reply.send(data.data);
		});

		fastify.get('/v1/trends/links', async (_request, reply) => {
			// As we do not have any system for news/links this will just return empty
			reply.send([]);
		});

		fastify.get('/v1/preferences', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getPreferences();
			reply.send(data.data);
		});

		fastify.get('/v1/followed_tags', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.getFollowedTags();
			reply.send(data.data);
		});

		fastify.get<{ Querystring: TimelineArgs }>('/v1/bookmarks', async (_request, reply) => {
			const { client, me } = await this.clientService.getAuthClient(_request);

			const data = await client.getBookmarks(parseTimelineArgs(_request.query));
			const response = await Promise.all(data.data.map((status) => this.mastoConverters.convertStatus(status, me)));

			reply.send(response);
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
			const response = await Promise.all(data.data.map((status) => this.mastoConverters.convertStatus(status, me)));

			reply.send(response);
		});

		fastify.get<{ Querystring: TimelineArgs }>('/v1/mutes', async (_request, reply) => {
			const client = this.clientService.getClient(_request);

			const data = await client.getMutes(parseTimelineArgs(_request.query));
			const response = await Promise.all(data.data.map((account) => this.mastoConverters.convertAccount(account)));

			reply.send(response);
		});

		fastify.get<{ Querystring: TimelineArgs }>('/v1/blocks', async (_request, reply) => {
			const client = this.clientService.getClient(_request);

			const data = await client.getBlocks(parseTimelineArgs(_request.query));
			const response = await Promise.all(data.data.map((account) => this.mastoConverters.convertAccount(account)));

			reply.send(response);
		});

		fastify.get<{ Querystring: { limit?: string }}>('/v1/follow_requests', async (_request, reply) => {
			const client = this.clientService.getClient(_request);

			const limit = _request.query.limit ? parseInt(_request.query.limit) : 20;
			const data = await client.getFollowRequests(limit);
			const response = await Promise.all(data.data.map((account) => this.mastoConverters.convertAccount(account as Entity.Account)));

			reply.send(response);
		});

		fastify.post<{ Querystring: TimelineArgs, Params: { id?: string } }>('/v1/follow_requests/:id/authorize', { preHandler: upload.single('none') }, async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });

			const client = this.clientService.getClient(_request);
			const data = await client.acceptFollowRequest(_request.params.id);
			const response = convertRelationship(data.data);

			reply.send(response);
		});

		fastify.post<{ Querystring: TimelineArgs, Params: { id?: string } }>('/v1/follow_requests/:id/reject', { preHandler: upload.single('none') }, async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });

			const client = this.clientService.getClient(_request);
			const data = await client.rejectFollowRequest(_request.params.id);
			const response = convertRelationship(data.data);

			reply.send(response);
		});
		//#endregion

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
		}>('/v1/media/:id', { preHandler: upload.none() }, async (_request, reply) => {
			if (!_request.params.id) return reply.code(400).send({ error: 'BAD_REQUEST', error_description: 'Missing required parameter "id"' });

			const options = {
				..._request.body,
				is_sensitive: toBoolean(_request.body.is_sensitive),
			};
			const client = this.clientService.getClient(_request);
			const data = await client.updateMedia(_request.params.id, options);
			const response = convertAttachment(data.data);

			reply.send(response);
		});

		done();
	}
}
