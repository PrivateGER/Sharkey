/*
 * SPDX-FileCopyrightText: piuvas and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { CacheService } from '@/core/CacheService.js';
import { ApiLoggerService } from '@/server/api/ApiLoggerService.js';
import { bindThis } from '@/decorators.js';
import { CacheManagementService, ManagedRedisKVCache } from '@/global/CacheManagementService.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import { ApiError } from '../../error.js';

type ListenBrainzResponse = {
	title: string,
	artist: string,
	coverArt: string | undefined,
	listenbrainzUrl: string | undefined,
	musicbrainzUrl: string | undefined,
};

export const meta = {
	tags: ['users'],

	requireCredential: false, // thinking that having this be public may allow people to rate-limit our key.

	description: 'Fetch what the user is listening to.',

	res: {
		type: 'object',
		optional: true, nullable: false,
		properties: {
			title: { type: 'string', optional: false, nullable: false },
			artist: { type: 'string', optional: false, nullable: false },
			coverArt: { type: 'string', optional: true, nullable: false },
			listenbrainzUrl: { type: 'string', optional: true, nullable: false },
			musicbrainzUrl: { type: 'string', optional: true, nullable: false },
		},
	},

	errors: {
		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '10bbd034-29a9-4d14-8cdc-c34c14396154',
		},
		noListenbrainz: {
			message: 'The user does not have a listenbrainz url.',
			code: 'NO_LISTENBRAINZ',
			id: '93b56660-3c52-4d47-9d5a-d57b0dd38f0a',
		},
		listenbrainzError: {
			message: 'Error while fetching ListenBrainz data. Contact an instance administrator.',
			code: 'LISTENBRAINZ_ERROR',
			id: '42d2d282-0acd-432c-9431-d1504291e3fb',
		},
	},

	limit: {
		duration: 1000,
		max: 5,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	private readonly listenBrainzCache: ManagedRedisKVCache<CachedListenBrainzEntity>;
	private readonly listenBrainzMetadataCache: ManagedRedisKVCache<CachedListenBrainzEntity>;

	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		private httpRequestService: HttpRequestService,
		private readonly cacheService: CacheService,
		private readonly loggerService: ApiLoggerService,

		cacheManagementService: CacheManagementService,
	) {
		super(meta, paramDef, async (ps) => {
			const profile = await this.cacheService.userProfileCache.fetch(ps.userId);

			const listenbrainzUsername = profile.listenbrainz;
			if (!listenbrainzUsername) {
				throw new ApiError(meta.errors.noListenbrainz);
			}

			const cachedResponse = await this.getCachedListenBrainz(listenbrainzUsername);
			if (cachedResponse !== null) {
				return cachedResponse;
			}

			const headers: Record<string, string> = {
				'Accept': 'application/json',
			};
			if (this.serverSettings.listenbrainzAuthKey) {
				headers['Authorization'] = `Token ${this.serverSettings.listenbrainzAuthKey}`;
			}

			const json = await this.httpRequestService.getJson<
				{
					payload?: {
						listens?: Array<{
							track_metadata?: {
								artist_name?: string,
								track_name?: string,
								release_name?: string,
								additional_info?: {
									release_mbid?: string,
									recording_mbid?: string,
								},
							},
						}>
					}
				}
			>(`https://api.listenbrainz.org/1/user/${encodeURIComponent(listenbrainzUsername)}/playing-now`,
				undefined,
				headers,
				undefined,
				10000,
			).catch((err) => {
				this.loggerService.logger.error(`/playing-now error: ${renderInlineError(err)}`);
				throw new ApiError(meta.errors.listenbrainzError);
			});

			// /1/user/{user}/playing-now returns an array, but it only has a single item even if you are listening from multiple
			// devices. this happens because the schema is shared between /listens, which returns multiple tracks.

			const playingNow = json.payload?.listens?.[0];
			if (!json.payload?.listens?.length || !playingNow?.track_metadata?.track_name || !playingNow.track_metadata.artist_name) {
				await this.setCachedListenBrainz(listenbrainzUsername, undefined);
				return undefined;
			}

			const response: ListenBrainzResponse = {
				title: playingNow.track_metadata.track_name,
				artist: playingNow.track_metadata.artist_name,
				coverArt: undefined,
				listenbrainzUrl: undefined,
				musicbrainzUrl: undefined,
			};

			// also, additional_info MAY contain release_mbid and/or recording_mbid, which are more accurate than the lookup data.

			if (playingNow.track_metadata.additional_info?.release_mbid) {
				response.coverArt =
					`https://coverartarchive.org/release/${encodeURIComponent(playingNow.track_metadata.additional_info.release_mbid)}/front-250`;
			}

			if (playingNow.track_metadata.additional_info?.recording_mbid) {
				response.musicbrainzUrl =
					`https://musicbrainz.org/recording/${encodeURIComponent(playingNow.track_metadata.additional_info.recording_mbid)}`;
				response.listenbrainzUrl =
					`https://listenbrainz.org/player?recording_mbids=${encodeURIComponent(playingNow.track_metadata.additional_info.recording_mbid)}`;
			}

			if ((!response.coverArt || !response.musicbrainzUrl || !response.listenbrainzUrl) && this.serverSettings.listenbrainzAuthKey) {
				const cachedResponse = await this.getCachedMetadata(response.artist, response.title);
				if (cachedResponse !== null) {
					return cachedResponse;
				}

				const json = await this.httpRequestService.getJson<
					{
						release_mbid?: string,
						recording_mbid?: string,
					}
				>(
					`https://api.listenbrainz.org/1/metadata/lookup/?artist_name=${playingNow.track_metadata.artist_name}&recording_name=${playingNow.track_metadata.track_name}`,
					undefined,
					headers,
					undefined,
					10000,
				).catch((err) => {
					this.loggerService.logger.error(`listenbrainz /metadata/lookup error: ${renderInlineError(err)}`);
					throw new ApiError(meta.errors.listenbrainzError);
				});

				if (!json.release_mbid || !json.recording_mbid) {
					this.loggerService.logger.warn(`listenbrainz /metadata/lookup: malformed json\n${JSON.stringify(json)}`);
				}
				if (json.release_mbid) {
					response.coverArt ??= `https://coverartarchive.org/release/${encodeURIComponent(json.release_mbid)}/front-250`;
				}
				if (json.recording_mbid) {
					response.listenbrainzUrl ??= `https://listenbrainz.org/player?recording_mbids=${encodeURIComponent(json.recording_mbid)}`;
					response.musicbrainzUrl ??= `https://musicbrainz.org/recording/${encodeURIComponent(json.recording_mbid)}`;
				}

				await this.setCachedMetadata(response.artist, response.title, response);
			}

			await this.setCachedListenBrainz(listenbrainzUsername, response);

			return response;
		});

		this.listenBrainzCache = cacheManagementService.createRedisKVCache<CachedListenBrainzEntity>('listenbrainz', {
			lifetime: 1000 * 5, // 5 seconds
			memoryCacheLifetime: 1000 * 5, // 5 seconds
		});

		this.listenBrainzMetadataCache = cacheManagementService.createRedisKVCache<CachedListenBrainzEntity>('listenbrainzMetadata', {
			lifetime: 1000 * 60 * 60 * 24, // 1 week
			memoryCacheLifetime: 1000 * 60 * 10, // 10 minutes
		});
	}

	@bindThis
	private async getCachedListenBrainz(username: string): Promise<ListenBrainzResponse | undefined | null> {
		const cacheKey = username;

		const cached = await this.listenBrainzCache.get(cacheKey);
		if (cached) {
			if (cached.d) {
				return {
					title: cached.d.t,
					artist: cached.d.a,
					coverArt: cached.d.c,
					listenbrainzUrl: cached.d.l,
					musicbrainzUrl: cached.d.m,
				};
			} else {
				return undefined;
			}
		}

		// no cache entry : (
		return null;
	}

	@bindThis
	private async getCachedMetadata(artist: string, track: string): Promise<ListenBrainzResponse | undefined | null> {
		const cacheKey = `${artist}:${track}`;

		const cached = await this.listenBrainzMetadataCache.get(cacheKey);
		if (cached) {
			if (cached.d) {
				return {
					title: cached.d.t,
					artist: cached.d.a,
					coverArt: cached.d.c,
					listenbrainzUrl: cached.d.l,
					musicbrainzUrl: cached.d.m,
				};
			} else {
				return undefined;
			}
		}

		// no cache entry : (
		return null;
	}

	@bindThis
	private async setCachedListenBrainz(username: string, data: ListenBrainzResponse | undefined): Promise<void> {
		const cacheKey = username;

		if (data) {
			await this.listenBrainzCache.set(cacheKey, {
				d: {
					t: data.title,
					a: data.artist,
					c: data.coverArt,
					l: data.listenbrainzUrl,
					m: data.musicbrainzUrl,
				},
			});
		} else {
			await this.listenBrainzCache.set(cacheKey, { d: undefined });
		}
	}

	@bindThis
	private async setCachedMetadata(artist: string, track: string, data: ListenBrainzResponse | undefined): Promise<void> {
		const cacheKey = `${artist}:${track}`;

		if (data) {
			await this.listenBrainzMetadataCache.set(cacheKey, {
				d: {
					t: data.title,
					a: data.artist,
					c: data.coverArt,
					l: data.listenbrainzUrl,
					m: data.musicbrainzUrl,
				},
			});
		} else {
			await this.listenBrainzCache.set(cacheKey, { d: undefined });
		}
	}
}

interface CachedListenBrainzEntity {
	d?: {
		t: string,
		a: string,
		c?: string,
		l?: string,
		m?: string,
	}
}
