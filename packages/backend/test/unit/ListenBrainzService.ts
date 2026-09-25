/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import type { MiMeta, MiUserProfile } from '@/models/_.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { LoggerService } from '@/core/LoggerService.js';
import type { CacheManagementService } from '@/global/CacheManagementService.js';
import { ListenBrainzService } from '@/core/ListenBrainzService.js';

type GetJson = (url: string) => Promise<unknown>;

function playingNow(trackMetadata: Record<string, unknown>) {
	return { payload: { listens: [{ track_metadata: trackMetadata }] } };
}

describe(ListenBrainzService, () => {
	let getJson: jest.Mock<GetJson>;
	let service: ListenBrainzService;

	const profile = (listenbrainz: string) => ({ listenbrainz }) as MiUserProfile;

	beforeEach(() => {
		getJson = jest.fn<GetJson>();

		// Real caching behaviour, backed by plain maps instead of Redis
		const cacheManagementService = {
			createRedisKVCache: () => {
				const store = new Map<string, unknown>();
				return {
					get: async (key: string) => store.get(key),
					set: async (key: string, value: unknown) => { store.set(key, value); },
				};
			},
		} as unknown as CacheManagementService;

		const loggerService = {
			getLogger: () => ({ error: () => {}, warn: () => {}, debug: () => {} }),
		} as unknown as LoggerService;

		service = new ListenBrainzService(
			{ listenbrainzAuthKey: 'key' } as MiMeta,
			{ getJson } as unknown as HttpRequestService,
			loggerService,
			cacheManagementService,
		);
	});

	test('caches playing-now results that already have full metadata', async () => {
		getJson.mockResolvedValue(playingNow({
			artist_name: 'Artist',
			track_name: 'Track',
			additional_info: { release_mbid: 'release', recording_mbid: 'recording' },
		}));

		const first = await service.fetchForUser(profile('user'), true);
		const second = await service.fetchForUser(profile('user'), true);

		expect(second).toEqual(first);
		expect(getJson).toHaveBeenCalledTimes(1);
	});

	test('caches playing-now results that were completed from the metadata cache', async () => {
		getJson.mockImplementation(async (url) => {
			if (url.includes('/playing-now')) return playingNow({ artist_name: 'Artist', track_name: 'Track' });
			return { release_mbid: 'release', recording_mbid: 'recording' };
		});

		// Fills the metadata cache for this track
		await service.fetchForUser(profile('first'), true);
		getJson.mockClear();

		// Uses the metadata cache, then the per-user cache
		await service.fetchForUser(profile('second'), true);
		const cached = await service.fetchForUser(profile('second'), true);

		expect(cached?.coverArt).toBe('https://coverartarchive.org/release/release/front-250');
		expect(getJson).toHaveBeenCalledTimes(1);
	});

	test('does not mix up cached metadata of tracks whose names contain the key separator', async () => {
		getJson.mockImplementation(async (url) => {
			if (url.includes('/user/first/')) return playingNow({ artist_name: 'A:B', track_name: 'C' });
			if (url.includes('/user/second/')) return playingNow({ artist_name: 'A', track_name: 'B:C' });
			const params = new URL(url).searchParams;
			return { release_mbid: `release-${params.get('artist_name')}`, recording_mbid: 'recording' };
		});

		await service.fetchForUser(profile('first'), true);
		const second = await service.fetchForUser(profile('second'), true);

		expect(second?.artist).toBe('A');
		expect(second?.title).toBe('B:C');
		expect(second?.coverArt).toBe('https://coverartarchive.org/release/release-A/front-250');
	});

	test('encodes the metadata lookup query', async () => {
		getJson.mockImplementation(async (url) => {
			if (url.includes('/playing-now')) return playingNow({ artist_name: 'Simon & Garfunkel', track_name: 'Why? #1=2' });
			return {};
		});

		await service.fetchForUser(profile('user'), true);

		const lookupUrl = new URL(getJson.mock.calls[1][0]);
		expect(lookupUrl.pathname).toBe('/1/metadata/lookup/');
		expect(lookupUrl.searchParams.get('artist_name')).toBe('Simon & Garfunkel');
		expect(lookupUrl.searchParams.get('recording_name')).toBe('Why? #1=2');
		expect([...lookupUrl.searchParams.keys()]).toEqual(['artist_name', 'recording_name']);
	});
});
