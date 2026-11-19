/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import Fastify from 'fastify';
import { ApiStatusMastodon } from '@/server/api/mastodon/endpoints/status.js';

describe('Mastodon thread backfill', () => {
	// The backfill that is currently running, if any.
	let inProgress: { noteId: string, backfillId: string } | null;
	let requested: string[];
	let me: { id: string } | null;

	const replyBackfillService = {
		requestAutomatic: async (noteId: string) => {
			requested.push(noteId);
		},
		findInProgress: async (noteIds: string[]) => inProgress && noteIds.includes(inProgress.noteId) ? inProgress : null,
		isInProgress: async (noteId: string, backfillId: string) => inProgress?.noteId === noteId && inProgress.backfillId === backfillId,
	};
	const client = {
		getStatusContext: async () => ({ data: { ancestors: [{ id: 'root' }, { id: 'parent' }], descendants: [{ id: 'reply' }] } }),
	};

	function createServer() {
		const fastify = Fastify();
		new ApiStatusMastodon(
			{ convertStatus: async (status: { id: string }) => ({ id: status.id }) } as never,
			{ getAuthClient: async () => ({ client, me }), getAuth: async () => me } as never,
			{} as never,
			replyBackfillService as never,
		).register(fastify);
		return fastify;
	}

	beforeEach(() => {
		inProgress = null;
		requested = [];
		me = { id: 'viewer' };
	});

	test('a thread says nothing about a backfill when none is running', async () => {
		const res = await createServer().inject({ method: 'GET', url: '/v1/statuses/note/context' });

		expect(res.statusCode).toBe(200);
		expect(res.headers['mastodon-async-refresh']).toBeUndefined();
	});

	test('a signed-in viewer makes the server look for missing replies, an anonymous one does not', async () => {
		await createServer().inject({ method: 'GET', url: '/v1/statuses/note/context' });
		expect(requested).toEqual(['note']);

		me = null;
		await createServer().inject({ method: 'GET', url: '/v1/statuses/other/context' });
		expect(requested).toEqual(['note']);
	});

	test.each(['note', 'root'])('a thread announces a backfill running for %s, and the announced ID reports its progress', async (noteId) => {
		inProgress = { noteId, backfillId: 'backfill1' };
		const fastify = createServer();

		const context = await fastify.inject({ method: 'GET', url: '/v1/statuses/note/context' });
		const announced = /^id="([^"]+)", retry=\d+$/.exec(String(context.headers['mastodon-async-refresh']));
		expect(announced).not.toBeNull();

		const running = await fastify.inject({ method: 'GET', url: `/v1_alpha/async_refreshes/${announced?.[1]}` });
		expect(running.json()).toEqual({ async_refresh: { id: announced?.[1], status: 'running', result_count: null } });

		inProgress = null;
		const finished = await fastify.inject({ method: 'GET', url: `/v1_alpha/async_refreshes/${announced?.[1]}` });
		expect(finished.json().async_refresh.status).toBe('finished');
	});

	test('progress is only reported to a signed-in caller', async () => {
		me = null;

		const res = await createServer().inject({ method: 'GET', url: '/v1_alpha/async_refreshes/note-backfill1' });

		expect(res.statusCode).toBe(401);
	});
});
