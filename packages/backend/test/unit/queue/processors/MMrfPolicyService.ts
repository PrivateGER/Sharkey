/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as assert from 'node:assert';
import { MMrfAction, MMrfPolicyService } from '@/queue/processors/MMrfPolicy.js';
import type { IActivity } from '@/core/activitypub/type.js';

const logger = {
	warn: () => undefined,
	info: () => undefined,
	error: () => undefined,
};

const runtimeContext = {
	actor: {
		uri: 'https://remote.example/users/alice',
		host: 'remote.example',
		followersCount: 1,
		followingCount: 1,
	},
	localHost: 'local.example',
	signerHost: 'remote.example',
	receivedAt: '2026-06-14T00:00:00.000Z',
};

const keywordActivity = {
	id: 'https://remote.example/activities/1',
	type: 'Create',
	actor: 'https://remote.example/users/alice',
	object: {
		id: 'https://remote.example/notes/1',
		type: 'Note',
		content: 'join https://discord.gg/ctkpaarr now',
		tag: [],
	},
} satisfies IActivity;

const followActivity = {
	id: 'https://remote.example/activities/2',
	type: 'Follow',
	actor: 'https://remote.example/users/alice',
	object: 'https://local.example/users/bob',
} satisfies IActivity;

const announceActivity = {
	id: 'https://remote.example/activities/3',
	type: 'Announce',
	actor: 'https://remote.example/users/alice',
	object: 'https://remote.example/notes/1',
} satisfies IActivity;

function createPolicyRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'policy1',
		name: 'Policy 1',
		source: 'function filter(ctx) return mrf.accept() end',
		timeoutMs: 100,
		paramsSchema: {},
		params: {},
		scope: {
			activityTypes: ['Create'],
			objectTypes: ['Note'],
		},
		...overrides,
	};
}

function createService(policyRows: unknown[]) {
	return new MMrfPolicyService(
		{
			find: async () => policyRows,
		} as any,
		{
			findOneBy: async () => null,
		} as any,
		{
			findOne: async () => null,
		} as any,
		{
			getUserFromApId: async () => null,
		} as any,
	);
}

describe('MMrfPolicyService', () => {
	test('uses DB configured policies instead of hardcoded bundled fallbacks', async () => {
		const service = createService([]);

		const result = await service.run(keywordActivity, logger as any, runtimeContext);

		assert.equal(result.action, MMrfAction.Neutral);
	});

	test('skips Lua execution when a policy scope does not match the inbox activity', async () => {
		const service = createService([
			createPolicyRow({
				source: 'function filter(ctx) return mrf.reject("should not run") end',
			}),
		]);

		const result = await service.run(followActivity, logger as any, runtimeContext);

		assert.equal(result.action, MMrfAction.Neutral);
		assert.deepStrictEqual(result.data, followActivity);
	});

	test('runs policies scoped to non-note activity types', async () => {
		const service = createService([
			createPolicyRow({
				scope: {
					activityTypes: ['Announce'],
					objectTypes: null,
				},
				source: 'function filter(ctx) return mrf.reject("blocked announce") end',
			}),
		]);

		const result = await service.run(announceActivity, logger as any, runtimeContext);

		assert.equal(result.action, MMrfAction.RejectNote);
		assert.match(result.reason ?? '', /blocked announce/);
	});

	test('fails open for runtime errors by default', async () => {
		const service = createService([
			createPolicyRow({
				source: 'function filter(ctx) error("broken policy") end',
			}),
		]);

		const result = await service.run(keywordActivity, logger as any, runtimeContext);

		assert.equal(result.action, MMrfAction.Neutral);
		assert.deepStrictEqual(result.data, keywordActivity);
	});

	test('keeps explicit policy rejections as enforcement decisions', async () => {
		const service = createService([
			createPolicyRow({
				source: 'function filter(ctx) return mrf.reject("explicit rejection") end',
			}),
		]);

		const result = await service.run(keywordActivity, logger as any, runtimeContext);

		assert.equal(result.action, MMrfAction.RejectNote);
		assert.match(result.reason ?? '', /explicit rejection/);
	});
});
