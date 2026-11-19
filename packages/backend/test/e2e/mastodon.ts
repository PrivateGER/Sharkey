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
	});
});
