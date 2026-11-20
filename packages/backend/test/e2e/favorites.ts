/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { api, post, signup, uploadFile } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('i/favorites filters', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	let carol: misskey.entities.SignupResponse;

	let bobPlain: misskey.entities.Note;
	let bobCw: misskey.entities.Note;
	let bobPercent: misskey.entities.Note;
	let carolWithFile: misskey.entities.Note;

	async function favoriteIds(params: misskey.Endpoints['i/favorites']['req']): Promise<string[]> {
		const res = await api('i/favorites', { limit: 100, ...params }, alice);
		assert.strictEqual(res.status, 200);
		return res.body.map(favorite => favorite.noteId).sort();
	}

	beforeAll(async () => {
		alice = await signup({ username: 'favAlice' });
		bob = await signup({ username: 'favBob' });
		carol = await signup({ username: 'favCarol' });

		bobPlain = await post(bob, { text: 'Lunch was Excellent Ramen' });
		bobCw = await post(bob, { cw: 'ramen review', text: 'spoilers inside' });
		bobPercent = await post(bob, { text: 'battery at 100% again' });
		const file = await uploadFile(carol);
		assert.ok(file.body);
		carolWithFile = await post(carol, { text: 'a picture', fileIds: [file.body.id] });

		for (const note of [bobPlain, bobCw, bobPercent, carolWithFile]) {
			await api('notes/favorites/create', { noteId: note.id }, alice);
		}
	}, 1000 * 60 * 2);

	test('no filters returns every favorite', async () => {
		assert.deepStrictEqual(await favoriteIds({}), [bobPlain.id, bobCw.id, bobPercent.id, carolWithFile.id].sort());
	});

	test('search matches text and content warning case-insensitively', async () => {
		assert.deepStrictEqual(await favoriteIds({ query: 'RAMEN' }), [bobPlain.id, bobCw.id].sort());
	});

	test('search treats LIKE wildcards literally', async () => {
		assert.deepStrictEqual(await favoriteIds({ query: '100%' }), [bobPercent.id]);
		assert.deepStrictEqual(await favoriteIds({ query: '_' }), []);
	});

	test('blank search does not filter', async () => {
		assert.strictEqual((await favoriteIds({ query: '   ' })).length, 4);
	});

	test('withFiles keeps only notes with attachments', async () => {
		assert.deepStrictEqual(await favoriteIds({ withFiles: true }), [carolWithFile.id]);
	});

	test('userId keeps only notes by that user', async () => {
		assert.deepStrictEqual(await favoriteIds({ userId: carol.id }), [carolWithFile.id]);
	});

	test('filters combine', async () => {
		assert.deepStrictEqual(await favoriteIds({ userId: bob.id, query: 'spoilers' }), [bobCw.id]);
		assert.deepStrictEqual(await favoriteIds({ userId: carol.id, query: 'ramen' }), []);
	});
});

describe('i/favorites with notes the caller can no longer read', () => {
	test('content filters do not match them', async () => {
		const reader = await signup({ username: 'favReader' });
		const author = await signup({ username: 'favAuthor' });
		await api('following/create', { userId: author.id }, reader);
		const file = await uploadFile(author);
		assert.ok(file.body);
		const secret = await post(author, { visibility: 'followers', text: 'secret launch codes', fileIds: [file.body.id] });
		assert.strictEqual((await api('notes/favorites/create', { noteId: secret.id }, reader)).status, 204);
		await api('following/delete', { userId: author.id }, reader);

		const search = await api('i/favorites', { query: 'launch codes' }, reader);
		const withFiles = await api('i/favorites', { withFiles: true }, reader);
		const unfiltered = await api('i/favorites', {}, reader);

		assert.deepStrictEqual(search.body, []);
		assert.deepStrictEqual(withFiles.body, []);
		// Without content filters the favorite is still listed, redacted, as before.
		assert.strictEqual(unfiltered.body.length, 1);
		assert.strictEqual(unfiltered.body[0].note.isHidden, true);
		assert.strictEqual(unfiltered.body[0].note.text, null);
	});
});
