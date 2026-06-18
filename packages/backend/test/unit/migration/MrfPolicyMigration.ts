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
		const createTable = queries.find(query => query.sql.includes('CREATE TABLE "mrf_policy"'));
		const builtinInserts = queries.filter(query => query.sql.includes('INSERT INTO "mrf_policy"'));

		assert.deepStrictEqual(builtinPolicyIds, ['keyword-filter', 'new-user-spam', 'hellthread']);
		assert.match(createTable?.sql ?? '', /"scope" jsonb NOT NULL DEFAULT/);
		assert.doesNotMatch(createTable?.sql ?? '', /"failureMode"/);
		for (const query of builtinInserts) {
			assert.match(query.sql, /"scope"/);
			assert.doesNotMatch(query.sql, /"failureMode"/);
			assert.deepStrictEqual(JSON.parse(query.params?.[6] as string), {
				activityTypes: ['Create'],
				objectTypes: ['Note'],
			});
		}
	});
});
