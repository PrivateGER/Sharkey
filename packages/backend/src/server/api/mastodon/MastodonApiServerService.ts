/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import querystring from 'querystring';
import { megalodon, Entity, MegalodonInterface } from 'megalodon';
import { IsNull } from 'typeorm';
import multer from 'fastify-multer';
import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokensRepository, UserProfilesRepository, UsersRepository, MiMeta } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { Config } from '@/config.js';
import { DriveService } from '@/core/DriveService.js';
import { getErrorData, MastodonLogger } from '@/server/api/mastodon/MastodonLogger.js';
import { ApiAccountMastodonRoute } from '@/server/api/mastodon/endpoints/account.js';
import { ApiSearchMastodonRoute } from '@/server/api/mastodon/endpoints/search.js';
import { ApiFilterMastodonRoute } from '@/server/api/mastodon/endpoints/filter.js';
import { ApiNotifyMastodonRoute } from '@/server/api/mastodon/endpoints/notifications.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';
import { MiLocalUser } from '@/models/User.js';
import { AuthMastodonRoute } from './endpoints/auth.js';
import { toBoolean } from './timelineArgs.js';
import { convertAnnouncement, convertFilter, convertAttachment, convertFeaturedTag, convertList, MastoConverters } from './converters.js';
import { getInstance } from './endpoints/meta.js';
import { ApiAuthMastodon, ApiAccountMastodon, ApiFilterMastodon, ApiNotifyMastodon, ApiSearchMastodon, ApiTimelineMastodon, ApiStatusMastodon } from './endpoints.js';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';

export function getAccessToken(authorization: string | undefined): string | null {
	const accessTokenArr = authorization?.split(' ') ?? [null];
	return accessTokenArr[accessTokenArr.length - 1];
}

export function getClient(BASE_URL: string, authorization: string | undefined): MegalodonInterface {
	const accessToken = getAccessToken(authorization);
	return megalodon('misskey', BASE_URL, accessToken);
}

@Injectable()
export class MastodonApiServerService {
	constructor(
		@Inject(DI.meta)
		private readonly serverSettings: MiMeta,
		@Inject(DI.usersRepository)
		private readonly usersRepository: UsersRepository,
		@Inject(DI.userProfilesRepository)
		private readonly userProfilesRepository: UserProfilesRepository,
		@Inject(DI.accessTokensRepository)
		private readonly accessTokensRepository: AccessTokensRepository,
		@Inject(DI.config)
		private readonly config: Config,
		private readonly driveService: DriveService,
		private readonly mastoConverters: MastoConverters,
		private readonly logger: MastodonLogger,
		private readonly authenticateService: AuthenticateService,
	) { }

	@bindThis
	public async getAuthClient(request: FastifyRequest): Promise<{ client: MegalodonInterface, me: MiLocalUser | null }> {
		const accessToken = getAccessToken(request.headers.authorization);
		const [me] = await this.authenticateService.authenticate(accessToken);

		const baseUrl = `${request.protocol}://${request.host}`;
		const client = megalodon('misskey', baseUrl, accessToken);

		return { client, me };
	}

	@bindThis
	public async getAuthOnly(request: FastifyRequest): Promise<MiLocalUser | null> {
		const accessToken = getAccessToken(request.headers.authorization);
		const [me] = await this.authenticateService.authenticate(accessToken);
		return me;
	}

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
			reply.header('Access-Control-Allow-Origin', '*');
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

		fastify.register(multer.contentParser);

		fastify.get('/v1/custom_emojis', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				const data = await client.getInstanceCustomEmojis();
				reply.send(data.data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/custom_emojis', data);
				reply.code(401).send(data);
			}
		});

		fastify.get('/v1/instance', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens); // we are using this here, because in private mode some info isnt
			// displayed without being logged in
			try {
				const data = await client.getInstance();
				const admin = await this.usersRepository.findOne({
					where: {
						host: IsNull(),
						isRoot: true,
						isDeleted: false,
						isSuspended: false,
					},
					order: { id: 'ASC' },
				});
				const contact = admin == null ? null : await this.mastoConverters.convertAccount((await client.getAccount(admin.id)).data);
				reply.send(await getInstance(data.data, contact as Entity.Account, this.config, this.serverSettings));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/instance', data);
				reply.code(401).send(data);
			}
		});

		fastify.get('/v1/announcements', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				const data = await client.getInstanceAnnouncements();
				reply.send(data.data.map((announcement) => convertAnnouncement(announcement)));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/announcements', data);
				reply.code(401).send(data);
			}
		});

		fastify.post<{ Body: { id?: string } }>('/v1/announcements/:id/dismiss', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.body.id) return reply.code(400).send({ error: 'Missing required payload "id"' });
				const data = await client.dismissInstanceAnnouncement(_request.body['id']);
				reply.send(data.data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/announcements/${_request.body.id}/dismiss`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post('/v1/media', { preHandler: upload.single('file') }, async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				const multipartData = await _request.file();
				if (!multipartData) {
					reply.code(401).send({ error: 'No image' });
					return;
				}
				const data = await client.uploadMedia(multipartData);
				reply.send(convertAttachment(data.data as Entity.Attachment));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('POST /v1/media', data);
				reply.code(401).send(data);
			}
		});

		fastify.post<{ Body: { description?: string; focus?: string }}>('/v2/media', { preHandler: upload.single('file') }, async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				const multipartData = await _request.file();
				if (!multipartData) {
					reply.code(401).send({ error: 'No image' });
					return;
				}
				const data = await client.uploadMedia(multipartData, _request.body);
				reply.send(convertAttachment(data.data as Entity.Attachment));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('POST /v2/media', data);
				reply.code(401).send(data);
			}
		});

		fastify.get('/v1/filters', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens); // we are using this here, because in private mode some info isnt
			// displayed without being logged in
			try {
				const data = await client.getFilters();
				reply.send(data.data.map((filter) => convertFilter(filter)));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/filters', data);
				reply.code(401).send(data);
			}
		});

		fastify.get('/v1/trends', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens); // we are using this here, because in private mode some info isnt
			// displayed without being logged in
			try {
				const data = await client.getInstanceTrends();
				reply.send(data.data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/trends', data);
				reply.code(401).send(data);
			}
		});

		fastify.get('/v1/trends/tags', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens); // we are using this here, because in private mode some info isnt
			// displayed without being logged in
			try {
				const data = await client.getInstanceTrends();
				reply.send(data.data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/trends/tags', data);
				reply.code(401).send(data);
			}
		});

		fastify.get('/v1/trends/links', async (_request, reply) => {
			// As we do not have any system for news/links this will just return empty
			reply.send([]);
		});

		fastify.post<AuthMastodonRoute>('/v1/apps', { preHandler: upload.single('none') }, async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const client = getClient(BASE_URL, ''); // we are using this here, because in private mode some info isnt
			// displayed without being logged in
			try {
				const data = await ApiAuthMastodon(_request, client);
				reply.send(data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/apps', data);
				reply.code(401).send(data);
			}
		});

		fastify.get('/v1/preferences', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens); // we are using this here, because in private mode some info isnt
			// displayed without being logged in
			try {
				const data = await client.getPreferences();
				reply.send(data.data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/preferences', data);
				reply.code(401).send(data);
			}
		});

		//#region Accounts
		fastify.get<ApiAccountMastodonRoute>('/v1/accounts/verify_credentials', async (_request, reply) => {
			try {
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.verifyCredentials());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/accounts/verify_credentials', data);
				reply.code(401).send(data);
			}
		});

		fastify.patch<{
			Body: {
				discoverable?: string,
				bot?: string,
				display_name?: string,
				note?: string,
				avatar?: string,
				header?: string,
				locked?: string,
				source?: {
					privacy?: string,
					sensitive?: string,
					language?: string,
				},
				fields_attributes?: {
					name: string,
					value: string,
				}[],
			},
		}>('/v1/accounts/update_credentials', { preHandler: upload.any() }, async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens); // we are using this here, because in private mode some info isnt
			// displayed without being logged in
			try {
				// Check if there is an Header or Avatar being uploaded, if there is proceed to upload it to the drive of the user and then set it.
				if (_request.files.length > 0 && accessTokens) {
					const tokeninfo = await this.accessTokensRepository.findOneBy({ token: accessTokens.replace('Bearer ', '') });
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const avatar = (_request.files as any).find((obj: any) => {
						return obj.fieldname === 'avatar';
					});
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const header = (_request.files as any).find((obj: any) => {
						return obj.fieldname === 'header';
					});

					if (tokeninfo && avatar) {
						const upload = await this.driveService.addFile({
							user: { id: tokeninfo.userId, host: null },
							path: avatar.path,
							name: avatar.originalname !== null && avatar.originalname !== 'file' ? avatar.originalname : undefined,
							sensitive: false,
						});
						if (upload.type.startsWith('image/')) {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							(_request.body as any).avatar = upload.id;
						}
					} else if (tokeninfo && header) {
						const upload = await this.driveService.addFile({
							user: { id: tokeninfo.userId, host: null },
							path: header.path,
							name: header.originalname !== null && header.originalname !== 'file' ? header.originalname : undefined,
							sensitive: false,
						});
						if (upload.type.startsWith('image/')) {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							(_request.body as any).header = upload.id;
						}
					}
				}

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				if ((_request.body as any).fields_attributes) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const fields = (_request.body as any).fields_attributes.map((field: any) => {
						if (!(field.name.trim() === '' && field.value.trim() === '')) {
							if (field.name.trim() === '') return reply.code(400).send('Field name can not be empty');
							if (field.value.trim() === '') return reply.code(400).send('Field value can not be empty');
						}
						return {
							...field,
						};
					});
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(_request.body as any).fields_attributes = fields.filter((field: any) => field.name.trim().length > 0 && field.value.length > 0);
				}

				const options = {
					..._request.body,
					discoverable: toBoolean(_request.body.discoverable),
					bot: toBoolean(_request.body.bot),
					locked: toBoolean(_request.body.locked),
					source: _request.body.source ? {
						..._request.body.source,
						sensitive: toBoolean(_request.body.source.sensitive),
					} : undefined,
				};
				const data = await client.updateCredentials(options);
				reply.send(await this.mastoConverters.convertAccount(data.data));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('PATCH /v1/accounts/update_credentials', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<{ Querystring: { acct?: string }}>('/v1/accounts/lookup', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens); // we are using this here, because in private mode some info isn't displayed without being logged in
			try {
				if (!_request.query.acct) return reply.code(400).send({ error: 'Missing required property "acct"' });
				const data = await client.search(_request.query.acct, { type: 'accounts' });
				const profile = await this.userProfilesRepository.findOneBy({ userId: data.data.accounts[0].id });
				data.data.accounts[0].fields = profile?.fields.map(f => ({ ...f, verified_at: null })) ?? [];
				reply.send(await this.mastoConverters.convertAccount(data.data.accounts[0]));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/accounts/lookup', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiAccountMastodonRoute & { Querystring: { id?: string | string[], 'id[]'?: string | string[] }}>('/v1/accounts/relationships', async (_request, reply) => {
			try {
				const { client, me } = await this.getAuthClient(_request);
				let ids = _request.query['id[]'] ?? _request.query['id'] ?? [];
				if (typeof ids === 'string') {
					ids = [ids];
				}
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.getRelationships(ids));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/accounts/relationships', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<{ Params: { id?: string } }>('/v1/accounts/:id', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.getAccount(_request.params.id);
				const account = await this.mastoConverters.convertAccount(data.data);
				reply.send(account);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/accounts/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/accounts/:id/statuses', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.getStatuses());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/accounts/${_request.params.id}/statuses`, data);
				reply.code(401).send(data);
			}
		});

		fastify.get<{ Params: { id?: string } }>('/v1/accounts/:id/featured_tags', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.getFeaturedTags();
				reply.send(data.data.map((tag) => convertFeaturedTag(tag)));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/accounts/${_request.params.id}/featured_tags`, data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/accounts/:id/followers', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.getFollowers());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/accounts/${_request.params.id}/followers`, data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/accounts/:id/following', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.getFollowing());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/accounts/${_request.params.id}/following`, data);
				reply.code(401).send(data);
			}
		});

		fastify.get<{ Params: { id?: string } }>('/v1/accounts/:id/lists', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const data = await client.getAccountLists(_request.params.id);
				reply.send(data.data.map((list) => convertList(list)));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/accounts/${_request.params.id}/lists`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/accounts/:id/follow', { preHandler: upload.single('none') }, async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.addFollow());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/accounts/${_request.params.id}/follow`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/accounts/:id/unfollow', { preHandler: upload.single('none') }, async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.rmFollow());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/accounts/${_request.params.id}/unfollow`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/accounts/:id/block', { preHandler: upload.single('none') }, async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.addBlock());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/accounts/${_request.params.id}/block`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/accounts/:id/unblock', { preHandler: upload.single('none') }, async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.rmBlock());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/accounts/${_request.params.id}/unblock`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/accounts/:id/mute', { preHandler: upload.single('none') }, async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.addMute());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/accounts/${_request.params.id}/mute`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/accounts/:id/unmute', { preHandler: upload.single('none') }, async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.rmMute());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/accounts/${_request.params.id}/unmute`, data);
				reply.code(401).send(data);
			}
		});

		fastify.get('/v1/followed_tags', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				const data = await client.getFollowedTags();
				reply.send(data.data);
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/followed_tags', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiAccountMastodonRoute>('/v1/bookmarks', async (_request, reply) => {
			try {
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.getBookmarks());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/bookmarks', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiAccountMastodonRoute>('/v1/favourites', async (_request, reply) => {
			try {
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.getFavourites());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/favourites', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiAccountMastodonRoute>('/v1/mutes', async (_request, reply) => {
			try {
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.getMutes());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/mutes', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiAccountMastodonRoute>('/v1/blocks', async (_request, reply) => {
			try {
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.getBlocks());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/blocks', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<{ Querystring: { limit?: string }}>('/v1/follow_requests', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				const limit = _request.query.limit ? parseInt(_request.query.limit) : 20;
				const data = await client.getFollowRequests(limit);
				reply.send(await Promise.all(data.data.map(async (account) => await this.mastoConverters.convertAccount(account as Entity.Account))));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/follow_requests', data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/follow_requests/:id/authorize', { preHandler: upload.single('none') }, async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.acceptFollow());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/follow_requests/${_request.params.id}/authorize`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiAccountMastodonRoute & { Params: { id?: string } }>('/v1/follow_requests/:id/reject', { preHandler: upload.single('none') }, async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const account = new ApiAccountMastodon(_request, client, me, this.mastoConverters);
				reply.send(await account.rejectFollow());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/follow_requests/${_request.params.id}/reject`, data);
				reply.code(401).send(data);
			}
		});
		//#endregion

		//#region Search
		fastify.get<ApiSearchMastodonRoute>('/v1/search', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			try {
				const { client, me } = await this.getAuthClient(_request);
				const search = new ApiSearchMastodon(_request, client, me, BASE_URL, this.mastoConverters);
				reply.send(await search.SearchV1());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/search', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiSearchMastodonRoute>('/v2/search', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			try {
				const { client, me } = await this.getAuthClient(_request);
				const search = new ApiSearchMastodon(_request, client, me, BASE_URL, this.mastoConverters);
				reply.send(await search.SearchV2());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v2/search', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiSearchMastodonRoute>('/v1/trends/statuses', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			try {
				const { client, me } = await this.getAuthClient(_request);
				const search = new ApiSearchMastodon(_request, client, me, BASE_URL, this.mastoConverters);
				reply.send(await search.getStatusTrends());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/trends/statuses', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiSearchMastodonRoute>('/v2/suggestions', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			try {
				const { client, me } = await this.getAuthClient(_request);
				const search = new ApiSearchMastodon(_request, client, me, BASE_URL, this.mastoConverters);
				reply.send(await search.getSuggestions());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v2/suggestions', data);
				reply.code(401).send(data);
			}
		});
		//#endregion

		//#region Notifications
		fastify.get<ApiNotifyMastodonRoute>('/v1/notifications', async (_request, reply) => {
			try {
				const { client, me } = await this.getAuthClient(_request);
				const notify = new ApiNotifyMastodon(_request, client, me, this.mastoConverters);
				reply.send(await notify.getNotifications());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('GET /v1/notifications', data);
				reply.code(401).send(data);
			}
		});

		fastify.get<ApiNotifyMastodonRoute & { Params: { id?: string } }>('/v1/notification/:id', async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const notify = new ApiNotifyMastodon(_request, client, me, this.mastoConverters);
				reply.send(await notify.getNotification());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/notification/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiNotifyMastodonRoute & { Params: { id?: string } }>('/v1/notification/:id/dismiss', { preHandler: upload.single('none') }, async (_request, reply) => {
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const { client, me } = await this.getAuthClient(_request);
				const notify = new ApiNotifyMastodon(_request, client, me, this.mastoConverters);
				reply.send(await notify.rmNotification());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/notification/${_request.params.id}/dismiss`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiNotifyMastodonRoute>('/v1/notifications/clear', { preHandler: upload.single('none') }, async (_request, reply) => {
			try {
				const { client, me } = await this.getAuthClient(_request);
				const notify = new ApiNotifyMastodon(_request, client, me, this.mastoConverters);
				reply.send(await notify.rmNotifications());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('POST /v1/notifications/clear', data);
				reply.code(401).send(data);
			}
		});
		//#endregion

		//#region Filters
		fastify.get<ApiFilterMastodonRoute & { Params: { id?: string } }>('/v1/filters/:id', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				const filter = new ApiFilterMastodon(_request, client);
				_request.params.id
					? reply.send(await filter.getFilter())
					: reply.send(await filter.getFilters());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`GET /v1/filters/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiFilterMastodonRoute>('/v1/filters', { preHandler: upload.single('none') }, async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				const filter = new ApiFilterMastodon(_request, client);
				reply.send(await filter.createFilter());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error('POST /v1/filters', data);
				reply.code(401).send(data);
			}
		});

		fastify.post<ApiFilterMastodonRoute & { Params: { id?: string } }>('/v1/filters/:id', { preHandler: upload.single('none') }, async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const filter = new ApiFilterMastodon(_request, client);
				reply.send(await filter.updateFilter());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`POST /v1/filters/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});

		fastify.delete<ApiFilterMastodonRoute & { Params: { id?: string } }>('/v1/filters/:id', async (_request, reply) => {
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const filter = new ApiFilterMastodon(_request, client);
				reply.send(await filter.rmFilter());
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`DELETE /v1/filters/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});
		//#endregion

		//#region Timelines
		const TLEndpoint = new ApiTimelineMastodon(fastify, this.mastoConverters, this.logger, this);

		// GET Endpoints
		TLEndpoint.getTL();
		TLEndpoint.getHomeTl();
		TLEndpoint.getListTL();
		TLEndpoint.getTagTl();
		TLEndpoint.getConversations();
		TLEndpoint.getList();
		TLEndpoint.getLists();
		TLEndpoint.getListAccounts();

		// POST Endpoints
		TLEndpoint.createList();
		TLEndpoint.addListAccount();

		// PUT Endpoint
		TLEndpoint.updateList();

		// DELETE Endpoints
		TLEndpoint.deleteList();
		TLEndpoint.rmListAccount();
		//#endregion

		//#region Status
		const NoteEndpoint = new ApiStatusMastodon(fastify, this.mastoConverters, this.logger, this.authenticateService, this);

		// GET Endpoints
		NoteEndpoint.getStatus();
		NoteEndpoint.getStatusSource();
		NoteEndpoint.getContext();
		NoteEndpoint.getHistory();
		NoteEndpoint.getReblogged();
		NoteEndpoint.getFavourites();
		NoteEndpoint.getMedia();
		NoteEndpoint.getPoll();

		//POST Endpoints
		NoteEndpoint.postStatus();
		NoteEndpoint.addFavourite();
		NoteEndpoint.rmFavourite();
		NoteEndpoint.reblogStatus();
		NoteEndpoint.unreblogStatus();
		NoteEndpoint.bookmarkStatus();
		NoteEndpoint.unbookmarkStatus();
		NoteEndpoint.pinStatus();
		NoteEndpoint.unpinStatus();
		NoteEndpoint.reactStatus();
		NoteEndpoint.unreactStatus();
		NoteEndpoint.votePoll();

		// PUT Endpoint
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
			const BASE_URL = `${_request.protocol}://${_request.host}`;
			const accessTokens = _request.headers.authorization;
			const client = getClient(BASE_URL, accessTokens);
			try {
				if (!_request.params.id) return reply.code(400).send({ error: 'Missing required parameter "id"' });
				const options = {
					..._request.body,
					is_sensitive: toBoolean(_request.body.is_sensitive),
				};
				const data = await client.updateMedia(_request.params.id, options);
				reply.send(convertAttachment(data.data));
			} catch (e) {
				const data = getErrorData(e);
				this.logger.error(`PUT /v1/media/${_request.params.id}`, data);
				reply.code(401).send(data);
			}
		});
		NoteEndpoint.updateStatus();

		// DELETE Endpoint
		NoteEndpoint.deleteStatus();
		//#endregion
		done();
	}
}
