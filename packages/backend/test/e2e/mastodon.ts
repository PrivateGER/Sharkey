/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { api, host, post, react, relativeFetch, signup, userList } from '../utils.js';
import type * as misskey from 'misskey-js';

type User = misskey.entities.SignupResponse;

async function masto(method: string, path: string, user?: User, body?: Record<string, unknown> | FormData) {
	const headers: Record<string, string> = {};
	if (user) headers['Authorization'] = `Bearer ${user.token}`;
	if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

	const res = await relativeFetch(`api/${path}`, {
		method,
		headers,
		body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();

	return {
		status: res.status,
		headers: res.headers,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		body: (text ? JSON.parse(text) : null) as any,
	};
}

describe('Mastodon API', () => {
	let alice: User;
	let bob: User;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
	}, 1000 * 60 * 2);

	describe('reaching the native API', () => {
		test('works without credentials', async () => {
			const res = await masto('GET', 'v1/instance');

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body.title, 'string');
		});

		test('carries the caller\'s credentials', async () => {
			const res = await masto('GET', 'v1/accounts/verify_credentials', alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.username, 'alice');
		});

		test('carries a request body', async () => {
			const created = await masto('POST', 'v1/statuses', alice, { status: 'hello from the mastodon api' });
			assert.strictEqual(created.status, 200);

			const fetched = await masto('GET', `v1/statuses/${created.body.id}`, bob);
			assert.strictEqual(fetched.status, 200);
			assert.strictEqual(fetched.body.id, created.body.id);
			assert.strictEqual(fetched.body.text, 'hello from the mastodon api');
			assert.strictEqual(fetched.body.account.username, 'alice');
		});

		test('passes a native error on with its status', async () => {
			const res = await masto('GET', 'v1/accounts/zzzzzzzzzzzzzzzz');

			assert.strictEqual(res.status, 404);
			assert.strictEqual(typeof res.body.error, 'string');
		});

		test('rejects a status the caller may not see', async () => {
			const note = await post(alice, { text: 'followers only', visibility: 'followers' });

			const res = await masto('GET', `v1/statuses/${note.id}`, bob);

			assert.strictEqual(res.status, 404);
		});
	});

	describe('discovery', () => {
		test('trending statuses are returned as statuses', async () => {
			const note = await post(alice, { text: 'a popular note' });
			// A reaction only counts towards the ranking 30% of the time, so repeat it until a miss is practically impossible.
			for (let i = 0; i < 40; i++) {
				await react(bob, note, '👍');
				await api('notes/reactions/delete', { noteId: note.id }, bob);
			}

			const res = await masto('GET', 'v1/trends/statuses');

			assert.strictEqual(res.status, 200);
			const trending = res.body.find((status: { id: string }) => status.id === note.id);
			assert.strictEqual(trending?.account.username, 'alice');
		});

		test('suggestions answer with a list', async () => {
			const res = await masto('GET', 'v2/suggestions', bob);

			assert.strictEqual(res.status, 200);
			assert.ok(Array.isArray(res.body));
		});
	});

	describe('media', () => {
		for (const path of ['v1/media', 'v2/media']) {
			test(`${path} stores the uploaded file`, async () => {
				const image = await readFile(fileURLToPath(new URL('../resources/192.jpg', import.meta.url)));
				const form = new FormData();
				form.append('file', new File([image], 'picture.jpg', { type: 'image/jpeg' }));
				form.append('description', 'a test picture');

				const res = await masto('POST', path, alice, form);

				assert.strictEqual(res.status, 200);
				assert.strictEqual(res.body.type, 'image');
				assert.strictEqual(res.body.description, 'a test picture');

				const stored = await api('drive/files/show', { fileId: res.body.id }, alice);
				assert.strictEqual(stored.body.size, image.length);
				assert.strictEqual(stored.body.name, 'picture.jpg');
			});
		}
	});

	describe('accounts', () => {
		test('lookup finds a local account by its exact name', async () => {
			for (const acct of ['alice', '@alice', `alice@${host}`]) {
				const res = await masto('GET', `v1/accounts/lookup?acct=${encodeURIComponent(acct)}`);

				assert.strictEqual(res.status, 200, acct);
				assert.strictEqual(res.body.id, alice.id, acct);
			}
		});

		test('lookup answers 404 for a name nobody has', async () => {
			for (const acct of ['ali', 'nobody_here']) {
				const res = await masto('GET', `v1/accounts/lookup?acct=${acct}`);

				assert.strictEqual(res.status, 404, acct);
			}
		});

		test('lookup answers 404 for a remote account that cannot be resolved', async () => {
			const res = await masto('GET', `v1/accounts/lookup?acct=${encodeURIComponent('nobody@example.invalid')}`);

			assert.strictEqual(res.status, 404);
		});

		test('lists names the caller\'s lists that contain the account', async () => {
			const withBob = await userList(alice, { name: 'with bob' });
			await userList(alice, { name: 'without bob' });
			await api('users/lists/push', { listId: withBob.id, userId: bob.id }, alice);

			const res = await masto('GET', `v1/accounts/${bob.id}/lists`, alice);

			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body.map((list: { title: string }) => list.title), ['with bob']);
		});

		test('a report reaches the moderators with the reported status', async () => {
			const note = await post(alice, { text: 'something reportable' });

			const res = await masto('POST', 'v1/reports', bob, {
				account_id: alice.id,
				status_ids: [note.id],
				comment: 'please look at this',
				category: 'spam',
			});

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.target_account.username, 'alice');
			assert.strictEqual(res.body.category, 'spam');

			// alice signed up first, which makes her the administrator.
			const reports = await api('admin/abuse-user-reports', {}, alice);
			const report = reports.body.find(r => r.targetUserId === alice.id && r.reporterId === bob.id);
			assert.ok(report?.comment.includes('please look at this'));
			assert.ok(report?.comment.includes(`/notes/${note.id}`));
		});
	});

	describe('statuses', () => {
		test('a bookmark shows on the status and in the bookmark list until it is removed', async () => {
			const note = await post(bob, { text: 'worth keeping' });

			const bookmarked = await masto('POST', `v1/statuses/${note.id}/bookmark`, alice);
			assert.strictEqual(bookmarked.status, 200);
			assert.strictEqual(bookmarked.body.bookmarked, true);
			assert.strictEqual((await masto('GET', `v1/statuses/${note.id}`, alice)).body.bookmarked, true);
			assert.strictEqual((await masto('GET', `v1/statuses/${note.id}`, bob)).body.bookmarked, false);
			assert.deepStrictEqual((await masto('GET', 'v1/bookmarks', alice)).body.map((status: { id: string }) => status.id), [note.id]);

			const unbookmarked = await masto('POST', `v1/statuses/${note.id}/unbookmark`, alice);
			assert.strictEqual(unbookmarked.status, 200);
			assert.strictEqual(unbookmarked.body.bookmarked, false);
			assert.deepStrictEqual((await masto('GET', 'v1/bookmarks', alice)).body, []);
		});

		test('a muted conversation is reported as muted until it is unmuted', async () => {
			const note = await post(bob, { text: 'a noisy thread' });

			const muted = await masto('POST', `v1/statuses/${note.id}/mute`, alice);
			assert.strictEqual(muted.status, 200);
			assert.strictEqual(muted.body.muted, true);
			assert.strictEqual((await masto('GET', `v1/statuses/${note.id}`, bob)).body.muted, false);

			const unmuted = await masto('POST', `v1/statuses/${note.id}/unmute`, alice);
			assert.strictEqual(unmuted.status, 200);
			assert.strictEqual(unmuted.body.muted, false);
		});

		test('repeating a bookmark, an unbookmark or a mute still succeeds', async () => {
			const note = await post(bob, { text: 'tapped twice' });

			for (const action of ['bookmark', 'bookmark', 'unbookmark', 'unbookmark', 'mute', 'mute', 'unmute', 'unmute']) {
				const res = await masto('POST', `v1/statuses/${note.id}/${action}`, alice);

				assert.strictEqual(res.status, 200, action);
			}
		});
	});

	describe('filters', () => {
		for (const path of ['v1/filters', 'v2/filters']) {
			test(`${path} is an empty list`, async () => {
				const res = await masto('GET', path, alice);

				assert.strictEqual(res.status, 200);
				assert.deepStrictEqual(res.body, []);
			});

			test(`${path} needs credentials`, async () => {
				const res = await masto('GET', path);

				assert.strictEqual(res.status, 401);
			});
		}
	});
});
