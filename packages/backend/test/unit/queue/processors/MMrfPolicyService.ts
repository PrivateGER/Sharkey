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

		const result = await service.run(keywordActivity, logger as any, {
			actor: {
				uri: 'https://remote.example/users/alice',
				host: 'remote.example',
				followersCount: 1,
				followingCount: 1,
			},
			localHost: 'local.example',
			signerHost: 'remote.example',
			receivedAt: '2026-06-14T00:00:00.000Z',
		});

		assert.equal(result.action, MMrfAction.Neutral);
	});
});
