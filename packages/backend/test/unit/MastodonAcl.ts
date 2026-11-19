/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import { ApiStatusMastodon } from '@/server/api/mastodon/endpoints/status.js';
import { ApiAccountMastodon } from '@/server/api/mastodon/endpoints/account.js';
import { ApiError } from '@/server/api/error.js';

describe('Mastodon compatibility ACLs', () => {
	function createReply() {
		return {
			code: jest.fn(function (this: any) {
				return this;
			}),
			send: jest.fn((body: unknown) => body),
		};
	}

	test('poll voting checks note visibility before calling the native vote endpoint', async () => {
		let voteHandler: any;
		const fastify = {
			get: jest.fn(),
			post: jest.fn((path: string, handler: any) => {
				if (path === '/v1/polls/:id/votes') voteHandler = handler;
			}),
			put: jest.fn(),
			delete: jest.fn(),
		};
		const client = {
			votePoll: jest.fn(async () => ({ data: { id: 'poll-a' } })),
		};
		const me = { id: 'user-a' };
		const mastodonDataService = {
			requireNote: jest.fn(async () => ({ id: 'note-a' })),
		};
		const service = new ApiStatusMastodon(
			{} as any,
			{ getAuthClient: jest.fn(async () => ({ client, me })) } as any,
			mastodonDataService as any,
		);

		service.register(fastify as any);
		await voteHandler({
			params: { id: 'note-a' },
			body: { choices: [0] },
		}, createReply());

		expect(mastodonDataService.requireNote).toHaveBeenCalledWith('note-a', me);
		expect(client.votePoll).toHaveBeenCalledWith('note-a', [0]);
	});

	test('avatar/header uploads require write:account before writing to Drive', async () => {
		let updateHandler: any;
		const fastify = {
			get: jest.fn(),
			patch: jest.fn((path: string, handler: any) => {
				if (path === '/v1/accounts/update_credentials') updateHandler = handler;
			}),
			post: jest.fn(),
		};
		const driveService = {
			addFile: jest.fn(async () => ({ id: 'file-a', type: 'image/png' })),
		};
		const accessTokensRepository = {
			findOneBy: jest.fn(async () => ({
				userId: 'user-a',
				permission: ['read:account'],
			})),
		};
		const client = {
			updateCredentials: jest.fn(async () => ({ data: { id: 'account-a' } })),
		};
		const reply = createReply();
		const service = new ApiAccountMastodon(
			accessTokensRepository as any,
			{ getClient: jest.fn(() => client) } as any,
			{} as any,
			driveService as any,
			{} as any,
		);

		service.register(fastify as any);
		await updateHandler({
			headers: { authorization: 'Bearer token-a' },
			savedRequestFiles: [{
				fieldname: 'avatar',
				filepath: '/tmp/avatar.png',
				filename: 'avatar.png',
			}],
			body: {},
		}, reply);

		expect(reply.code).toHaveBeenCalledWith(403);
		expect(accessTokensRepository.findOneBy).toHaveBeenCalledWith({ token: 'token-a' });
		expect(driveService.addFile).not.toHaveBeenCalled();
		expect(client.updateCredentials).not.toHaveBeenCalled();
	});

	test('thread context leaves out statuses the viewer cannot access', async () => {
		type Handler = (request: unknown, reply: unknown) => Promise<unknown>;
		let contextHandler: Handler | undefined;
		const fastify = {
			get: jest.fn((path: string, handler: Handler) => {
				if (path === '/v1/statuses/:id/context') contextHandler = handler;
			}),
			post: jest.fn(),
			put: jest.fn(),
			delete: jest.fn(),
		};
		const client = {
			getStatusContext: jest.fn(async () => ({
				data: {
					ancestors: [{ id: 'visible-parent' }, { id: 'hidden-parent' }],
					descendants: [
						{ id: 'hidden-reply' },
						{ id: 'reply-quoting-hidden', reblog: { id: 'hidden-quoted' } },
						{ id: 'visible-reply' },
					],
				},
			})),
		};
		const getNote = async (id: string) => id.startsWith('hidden') ? null : { id };
		const mastodonDataService = {
			getNote,
			requireNote: async (id: string) => {
				const note = await getNote(id);
				if (!note) throw new ApiError({ message: 'No such note.', code: 'NO_SUCH_NOTE', id: '24fcbfc6-2e37-42b6-8388-c29b3861a08d', httpStatusCode: 404 });
				return note;
			},
		};
		// Like the real converter, this needs the note behind the status and the note it quotes, and fails without them.
		const mastoConverters = {
			convertStatus: async (status: { id: string, reblog?: { id: string } }, _me: unknown, hints?: { note?: { id: string } }) => {
				const note = hints?.note ?? await mastodonDataService.requireNote(status.id);
				if (status.reblog) await mastodonDataService.requireNote(status.reblog.id);
				return { id: note.id };
			},
		};
		const reply = createReply();
		const service = new ApiStatusMastodon(
			mastoConverters as never,
			{ getAuthClient: async () => ({ client, me: null }) } as never,
			mastodonDataService as never,
		);

		service.register(fastify as never);
		await contextHandler?.({ params: { id: 'note-a' }, query: {} }, reply);

		expect(reply.send).toHaveBeenCalledWith({
			ancestors: [{ id: 'visible-parent' }],
			descendants: [{ id: 'visible-reply' }],
		});
	});
});
