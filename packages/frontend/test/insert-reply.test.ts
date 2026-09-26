/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { assert, describe, test } from 'vitest';
import type * as Misskey from 'misskey-js';
import { insertReply } from '@/utility/insert-reply.js';

function reply(id: string, createdAt: string): Misskey.entities.Note {
	return { id, createdAt } as Misskey.entities.Note;
}

describe(insertReply, () => {
	test('puts an older reply below newer ones instead of on top', () => {
		const replies = [reply('c', '2026-09-03T00:00:00Z'), reply('a', '2026-09-01T00:00:00Z')];

		insertReply(replies, reply('b', '2026-09-02T00:00:00Z'));

		assert.deepStrictEqual(replies.map(r => r.id), ['c', 'b', 'a']);
	});

	test('puts a reply older than all others at the end', () => {
		const replies = [reply('b', '2026-09-02T00:00:00Z')];

		insertReply(replies, reply('a', '2026-09-01T00:00:00Z'));

		assert.deepStrictEqual(replies.map(r => r.id), ['b', 'a']);
	});

	test('matches the server order for replies with the same timestamp', () => {
		const replies = [reply('a', '2026-09-01T00:00:00Z')];

		insertReply(replies, reply('b', '2026-09-01T00:00:00Z'));

		assert.deepStrictEqual(replies.map(r => r.id), ['b', 'a']);
	});

	test('ignores a reply that is already listed', () => {
		const replies = [reply('a', '2026-09-01T00:00:00Z')];

		assert.isFalse(insertReply(replies, reply('a', '2026-09-01T00:00:00Z')));
		assert.strictEqual(replies.length, 1);
	});
});
