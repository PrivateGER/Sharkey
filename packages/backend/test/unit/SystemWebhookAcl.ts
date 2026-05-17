/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { meta as createMeta } from '@/server/api/endpoints/admin/system-webhook/create.js';
import { meta as deleteMeta } from '@/server/api/endpoints/admin/system-webhook/delete.js';
import { meta as listMeta } from '@/server/api/endpoints/admin/system-webhook/list.js';
import { meta as showMeta } from '@/server/api/endpoints/admin/system-webhook/show.js';
import { meta as testMeta } from '@/server/api/endpoints/admin/system-webhook/test.js';
import { meta as updateMeta } from '@/server/api/endpoints/admin/system-webhook/update.js';

describe('admin/system-webhook ACL', () => {
	test('system webhook endpoints are administrator-only because responses include shared secrets', () => {
		for (const meta of [createMeta, deleteMeta, listMeta, showMeta, testMeta, updateMeta]) {
			expect(meta.requireAdmin).toBe(true);
			expect('requireModerator' in meta).toBe(false);
			expect(meta.secure).toBe(true);
		}
	});
});
