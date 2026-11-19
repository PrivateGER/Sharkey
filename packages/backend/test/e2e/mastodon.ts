/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { api, createAppToken, host, post, react, relativeFetch, signup, userList } from '../utils.js';
import type * as misskey from 'misskey-js';

type User = misskey.entities.SignupResponse;

async function masto(method: string, path: string, user?: { token: string }, body?: Record<string, unknown> | FormData | URLSearchParams) {
	const encoded = body instanceof FormData || body instanceof URLSearchParams;
	const headers: Record<string, string> = {};
	if (user) headers['Authorization'] = `Bearer ${user.token}`;
	if (body && !encoded) headers['Content-Type'] = 'application/json';

	const res = await relativeFetch(`api/${path}`, {
		method,
		headers,
		body: encoded ? body : body ? JSON.stringify(body) : undefined,
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

		test('accepts a trailing slash on the path', async () => {
			assert.strictEqual((await masto('GET', 'v1/instance/')).status, 200);
			assert.strictEqual((await masto('GET', 'v2/instance/?local=true')).status, 200);
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

		test('a report without a comment is accepted', async () => {
			const res = await masto('POST', 'v1/reports', alice, { account_id: bob.id });

			assert.strictEqual(res.status, 200);

			const reports = await api('admin/abuse-user-reports', {}, alice);
			assert.ok(reports.body.some(r => r.targetUserId === bob.id && r.reporterId === alice.id));
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

		test('a translation comes from the configured provider', async () => {
			const requests: { q: string, target: string }[] = [];
			const provider = createServer((req, res) => {
				let body = '';
				req.on('data', chunk => body += chunk);
				req.on('end', () => {
					requests.push(JSON.parse(body));
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify({ translatedText: 'Good morning', detectedLanguage: { language: 'de', confidence: 99 } }));
				});
			});
			provider.listen(0, '127.0.0.1');
			await once(provider, 'listening');

			try {
				const address = provider.address();
				assert.ok(address && typeof address === 'object');
				await api('admin/update-meta', { libreTranslateURL: `http://127.0.0.1:${address.port}/translate` }, alice);
				// The generated type of this parameter has no policies in it.
				await api('admin/roles/update-default-policies', { policies: { canUseTranslator: true } as unknown as Record<string, never> }, alice);
				const note = await post(bob, { text: 'Guten Morgen' });

				const res = await masto('POST', `v1/statuses/${note.id}/translate`, alice, { lang: 'en' });

				assert.strictEqual(res.status, 200);
				assert.ok(res.body.content.includes('Good morning'), res.body.content);
				assert.strictEqual(res.body.language, 'en');
				assert.strictEqual(res.body.detected_source_language, 'German');
				assert.strictEqual(res.body.provider, 'LibreTranslate');
				assert.deepStrictEqual(requests.map(request => [request.q, request.target]), [['Guten Morgen', 'en']]);
			} finally {
				provider.close();
			}
		});
	});

	describe('instance', () => {
		test('rules list the server rules', async () => {
			await api('admin/update-meta', { serverRules: ['be kind', 'no spam'] }, alice);

			const res = await masto('GET', 'v1/instance/rules');

			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body.map((rule: { text: string }) => rule.text), ['be kind', 'no spam']);
		});

		test('extended description is the server\'s about text', async () => {
			await api('admin/update-meta', { about: '<p>About this server</p>' }, alice);

			const res = await masto('GET', 'v1/instance/extended_description');

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.content, '<p>About this server</p>');
			assert.ok(!Number.isNaN(Date.parse(res.body.updated_at)), res.body.updated_at);
		});

		test('activity reports twelve weeks of whole numbers, newest first', async () => {
			const res = await masto('GET', 'v1/instance/activity');

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.length, 12);
			for (const [index, week] of res.body.entries()) {
				assert.strictEqual(Number(week.week), Number(res.body[0].week) - index * 7 * 24 * 60 * 60);
				for (const key of ['statuses', 'logins', 'registrations']) {
					assert.match(week[key], /^\d+$/, key);
				}
			}
		});
	});

	describe('markers', () => {
		const both = 'v1/markers?timeline[]=home&timeline[]=notifications';

		test('a saved position is returned, with a version that counts the saves', async () => {
			assert.deepStrictEqual((await masto('GET', both, bob)).body, {});

			const first = await masto('POST', 'v1/markers', bob, { home: { last_read_id: 'first' } });
			assert.strictEqual(first.status, 200);
			assert.strictEqual(first.body.home.last_read_id, 'first');
			assert.strictEqual(first.body.home.version, 0);

			const second = await masto('POST', 'v1/markers', bob, new URLSearchParams({ 'home[last_read_id]': 'second' }));
			assert.strictEqual(second.body.home.last_read_id, 'second');
			assert.strictEqual(second.body.home.version, 1);

			const stored = await masto('GET', both, bob);
			assert.deepStrictEqual(Object.keys(stored.body), ['home']);
			assert.deepStrictEqual(stored.body.home, second.body.home);
			assert.deepStrictEqual((await masto('GET', 'v1/markers?timeline[]=notifications', bob)).body, {});
		});

		test('a position follows the user to another app, but not to another user', async () => {
			await masto('POST', 'v1/markers', alice, { notifications: { last_read_id: 'seen' } });
			const app = { token: await createAppToken(alice, ['read:account']) };

			assert.strictEqual((await masto('GET', both, app)).body.notifications.last_read_id, 'seen');
			assert.strictEqual((await masto('GET', both, bob)).body.notifications, undefined);
		});

		test('an app needs the permission to save, and a caller needs to be signed in', async () => {
			const readOnly = { token: await createAppToken(alice, ['read:account']) };

			assert.strictEqual((await masto('POST', 'v1/markers', readOnly, { home: { last_read_id: 'x' } })).status, 403);
			assert.strictEqual((await masto('GET', both)).status, 401);
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
