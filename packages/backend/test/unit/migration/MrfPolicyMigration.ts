/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as assert from 'node:assert';
import { MrfPolicy1781706597000 } from '../../../migration/1781706597000-MrfPolicy.js';

describe('MRF policy migration', () => {
	test('seeds all built-in policies from the old hardcoded MRF set', async () => {
		const queries: Array<{ sql: string; params?: unknown[] }> = [];
		const migration = new MrfPolicy1781706597000();

		await migration.up({
			query: async (sql: string, params?: unknown[]) => {
				queries.push({ sql, params });
			},
		});

		const builtinPolicyIds = queries
			.flatMap(query => query.params ?? [])
			.filter(param => param === 'keyword-filter' || param === 'new-user-spam' || param === 'hellthread');

		assert.deepStrictEqual(builtinPolicyIds, ['keyword-filter', 'new-user-spam', 'hellthread']);
	});
});
