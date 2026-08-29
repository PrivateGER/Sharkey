import { Inject, Injectable } from '@nestjs/common';
import Logger from '@/logger.js';
import { DI } from '@/di-symbols.js';
import type { MiMeta, MiUserProfile } from '@/models/_.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import { CacheManagementService, ManagedRedisKVCache } from '@/global/CacheManagementService.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

type ListenBrainzResponse = {
	title: string,
	artist: string,
	coverArt: string | undefined,
	listenbrainzUrl: string | undefined,
	musicbrainzUrl: string | undefined,
};

type ListenBrainzPlayingNowResponse = {
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
};

type ListenBrainzMetadataResponse = {
	release_mbid?: string,
	recording_mbid?: string,
};

@Injectable()
export class ListenBrainzService {
	private readonly logger: Logger;
	private readonly listenBrainzCache: ManagedRedisKVCache<CachedListenBrainzEntity>;
	private readonly listenBrainzMetadataCache: ManagedRedisKVCache<CachedListenBrainzEntity>;

	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		private httpRequestService: HttpRequestService,
		loggerService: LoggerService,

		cacheManagementService: CacheManagementService,
	) {
		this.logger = loggerService.getLogger('listenBrainz');

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
	public async fetchForUser(profile: MiUserProfile, canUseApiKey: boolean): Promise<ListenBrainzResponse | undefined> {
		const listenbrainzUsername = profile.listenbrainz;
		if (!listenbrainzUsername) {
			throw new IdentifiableError('a72ff178-1c31-4f04-b2df-96ac5f6f3d5d', 'The user does not have a listenbrainz url.');
		}

		const cachedResponse = await this.getCachedListenBrainz(listenbrainzUsername);
		if (cachedResponse !== null) {
			return cachedResponse;
		}

		const headers: Record<string, string> = {
			'Accept': 'application/json',
		};
		if (this.serverSettings.listenbrainzAuthKey && canUseApiKey) {
			headers['Authorization'] = `Token ${this.serverSettings.listenbrainzAuthKey}`;
		}

		const json = await this.httpRequestService.getJson<ListenBrainzPlayingNowResponse>(
			`https://api.listenbrainz.org/1/user/${encodeURIComponent(listenbrainzUsername)}/playing-now`,
			undefined,
			headers,
			undefined,
			10000,
		).catch((err) => {
			this.logger.error(`ListenBrainz /playing-now error: ${renderInlineError(err)}`);
			throw new IdentifiableError('0a571121-d49d-4866-bb5b-b1656ee649b8', 'Error while fetching ListenBrainz data. Contact an instance administrator.');
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
				`https://listenbrainz.org/track/${encodeURIComponent(playingNow.track_metadata.additional_info.recording_mbid)}`;
		}

		if ((!response.coverArt || !response.musicbrainzUrl || !response.listenbrainzUrl)) {
			// we don't have full metadata. check if there's anything cached.
			const cachedResponse = await this.getCachedMetadata(response.artist, response.title);
			if (cachedResponse !== null) {
				return cachedResponse;
			}

			if (this.serverSettings.listenbrainzAuthKey && canUseApiKey) {
				// not cached, let's fetch it from listenbrainz.
				const json = await this.httpRequestService.getJson<ListenBrainzMetadataResponse>(
					`https://api.listenbrainz.org/1/metadata/lookup/?artist_name=${playingNow.track_metadata.artist_name}&recording_name=${playingNow.track_metadata.track_name}`,
					undefined,
					headers,
					undefined,
					10000,
				).catch((err) => {
					this.logger.error(`ListenBrainz /metadata/lookup error: ${renderInlineError(err)}`);
					throw new IdentifiableError('0a571121-d49d-4866-bb5b-b1656ee649b8', 'Error while fetching ListenBrainz data. Contact an instance administrator.');
				});

				if (!json.release_mbid || !json.recording_mbid) {
					this.logger.warn('listenbrainz /metadata/lookup: malformed json');
					this.logger.debug(`listenbrainz /metadata/lookup: ${JSON.stringify(json)}`);
				}
				if (json.release_mbid) {
					response.coverArt ??= `https://coverartarchive.org/release/${encodeURIComponent(json.release_mbid)}/front-250`;
				}
				if (json.recording_mbid) {
					response.listenbrainzUrl ??= `https://listenbrainz.org/track/${encodeURIComponent(json.recording_mbid)}`;
					response.musicbrainzUrl ??= `https://musicbrainz.org/recording/${encodeURIComponent(json.recording_mbid)}`;
				}

				await this.setCachedMetadata(response.artist, response.title, response);
			}

			await this.setCachedListenBrainz(listenbrainzUsername, response);
		}

		return response;
	};

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
			await this.listenBrainzMetadataCache.set(cacheKey, { d: undefined });
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
