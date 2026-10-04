process.env.NODE_ENV = 'test';

import { describe, test, expect } from '@jest/globals';
import Endpoint from '@/server/api/endpoints/users/listenbrainz.js';
import { ListenBrainzService } from '@/core/ListenBrainzService.js';
import { ApiError } from '@/server/api/error.js';
import type { ApiLoggerService } from '@/server/api/ApiLoggerService.js';
import type { RoleService } from '@/core/RoleService.js';
import type { CacheService } from '@/core/CacheService.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { LoggerService } from '@/core/LoggerService.js';
import type { CacheManagementService } from '@/global/CacheManagementService.js';
import type { MiMeta, MiUserProfile } from '@/models/_.js';

// The stubs below cover only the members these code paths touch; the full services need a database and Redis.
function createEndpoint(opts: { listenbrainz: string | null, getJson: () => Promise<unknown> }) {
	const listenBrainzService = new ListenBrainzService(
		{} as MiMeta,
		{ getJson: opts.getJson } as unknown as HttpRequestService,
		{ getLogger: () => ({ error: () => {} }) } as unknown as LoggerService,
		{
			createRedisKVCache: () => ({ get: async () => undefined, set: async () => {} }),
		} as unknown as CacheManagementService,
	);
	const roleService = { getUserPolicies: async () => ({ canFetchLBMetadata: false }) } as unknown as RoleService;
	const cacheService = {
		userProfileCache: { fetch: async () => ({ listenbrainz: opts.listenbrainz }) as MiUserProfile },
	} as unknown as CacheService;

	return new Endpoint({} as ApiLoggerService, roleService, cacheService, listenBrainzService);
}

async function callError(endpoint: Endpoint): Promise<unknown> {
	return await endpoint.exec({ userId: '9abcdefghi' }, null, null).then(
		() => { throw new Error('expected the endpoint to fail'); },
		(err: unknown) => err,
	);
}

describe('api:users/listenbrainz', () => {
	test('reports NO_LISTENBRAINZ for a user without a ListenBrainz account', async () => {
		const err = await callError(createEndpoint({
			listenbrainz: null,
			getJson: async () => { throw new Error('ListenBrainz must not be called'); },
		}));

		expect(err).toBeInstanceOf(ApiError);
		expect(err).toMatchObject({ code: 'NO_LISTENBRAINZ' });
	});

	test('reports LISTENBRAINZ_ERROR when ListenBrainz cannot be reached', async () => {
		const err = await callError(createEndpoint({
			listenbrainz: 'someone',
			getJson: async () => { throw new Error('connect ECONNREFUSED'); },
		}));

		expect(err).toBeInstanceOf(ApiError);
		expect(err).toMatchObject({ code: 'LISTENBRAINZ_ERROR' });
	});
});
