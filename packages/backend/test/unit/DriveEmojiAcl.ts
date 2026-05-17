/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import DriveFilesDeleteEndpoint from '@/server/api/endpoints/drive/files/delete.js';
import DriveFilesAttachedNotesEndpoint from '@/server/api/endpoints/drive/files/attached-notes.js';
import EmojiAddEndpoint from '@/server/api/endpoints/admin/emoji/add.js';
import EmojiUpdateEndpoint from '@/server/api/endpoints/admin/emoji/update.js';

describe('Drive and emoji ACLs', () => {
	const moderator = { id: '8wvhjghbxu', username: 'moderator', host: null };
	const crossUserFile = {
		id: '8wvhjghbxv',
		userId: '8wvhjghbxw',
		type: 'image/png',
		url: 'https://example.test/file.png',
		webpublicUrl: null,
		webpublicType: null,
	};

	test('write:drive app tokens cannot delete other users files via moderator role', async () => {
		const driveService = { deleteFile: jest.fn(async () => undefined) };
		const endpoint = new DriveFilesDeleteEndpoint(
			{ findOneBy: jest.fn(async () => crossUserFile) } as any,
			driveService as any,
			{ isModerator: jest.fn(async () => true) } as any,
			{} as any,
		);

		await expect(endpoint.exec({ fileId: crossUserFile.id }, moderator as any, {
			permission: ['write:drive'],
		} as any)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });

		expect(driveService.deleteFile).not.toHaveBeenCalled();
	});

	test('read:drive app tokens stay owner-scoped for attached note lookup', async () => {
		const driveFilesRepository = {
			findOneBy: jest.fn(async () => null),
		};
		const endpoint = new DriveFilesAttachedNotesEndpoint(
			driveFilesRepository as any,
			{} as any,
			{} as any,
			{} as any,
			{ isModerator: jest.fn(async () => true) } as any,
		);

		await expect(endpoint.exec({ fileId: crossUserFile.id, limit: 10 }, moderator as any, {
			permission: ['read:drive'],
		} as any)).rejects.toMatchObject({ code: 'NO_SUCH_FILE' });

		expect(driveFilesRepository.findOneBy).toHaveBeenCalledWith({
			id: crossUserFile.id,
			userId: moderator.id,
		});
	});

	test('emoji add refuses cross-user Drive files without Drive admin scope', async () => {
		const customEmojiService = {
			checkDuplicate: jest.fn(async () => false),
			add: jest.fn(async () => ({ id: 'emoji-a' })),
		};
		const endpoint = new EmojiAddEndpoint(
			{ findOneBy: jest.fn(async () => crossUserFile), update: jest.fn(async () => undefined) } as any,
			customEmojiService as any,
			{ packDetailed: jest.fn(async () => ({ id: '8wvhjghbxx' })) } as any,
			{ isModerator: jest.fn(async () => false) } as any,
		);

		await expect(endpoint.exec({
			name: 'emoji',
			fileId: crossUserFile.id,
		}, moderator as any, {
			permission: ['write:admin:emoji'],
		} as any)).rejects.toMatchObject({ code: 'NO_SUCH_FILE' });

		expect(customEmojiService.add).not.toHaveBeenCalled();
	});

	test('emoji update refuses cross-user Drive files without Drive admin scope', async () => {
		const customEmojiService = {
			update: jest.fn(async () => null),
		};
		const endpoint = new EmojiUpdateEndpoint(
			{ findOneBy: jest.fn(async () => crossUserFile) } as any,
			customEmojiService as any,
			{ isModerator: jest.fn(async () => false) } as any,
		);

		await expect(endpoint.exec({
			id: '8wvhjghbxx',
			fileId: crossUserFile.id,
		}, moderator as any, {
			permission: ['write:admin:emoji'],
		} as any)).rejects.toMatchObject({ code: 'NO_SUCH_FILE' });

		expect(customEmojiService.update).not.toHaveBeenCalled();
	});
});
