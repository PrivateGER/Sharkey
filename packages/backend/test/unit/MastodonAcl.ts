/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import { ApiStatusMastodon } from '@/server/api/mastodon/endpoints/status.js';
import { ApiAccountMastodon } from '@/server/api/mastodon/endpoints/account.js';

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
});
