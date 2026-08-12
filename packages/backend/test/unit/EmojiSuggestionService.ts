/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import { IsNull, QueryFailedError } from 'typeorm';
import { EmojiSuggestionService } from '@/core/EmojiSuggestionService.js';

describe('EmojiSuggestionService', () => {
	const user = { id: '9abc000001', username: 'proposer', host: null };
	const moderator = { id: '9abc000002', username: 'moderator', host: null };
	const file = {
		id: '9abc000003',
		userId: user.id,
		type: 'image/png',
		url: 'https://example.test/original.png',
		webpublicUrl: 'https://example.test/public.webp',
	};
	const emojiFile = {
		...file,
		id: '9abc000006',
		userId: null,
		url: 'https://example.test/emoji-original.png',
		webpublicUrl: 'https://example.test/emoji-public.webp',
	};
	const suggestion = {
		id: '9abc000004',
		userId: user.id,
		fileId: file.id,
		file,
		name: 'party_blob',
		category: 'Blobs',
		aliases: ['party'],
		license: 'CC0',
		localOnly: false,
		isSensitive: false,
	};

	function createService(overrides?: {
		suggestions?: Record<string, unknown>;
		drive?: Record<string, unknown>;
		emojis?: Record<string, unknown>;
		customEmoji?: Record<string, unknown>;
		driveService?: Record<string, unknown>;
	}) {
		const suggestions = {
			countBy: jest.fn(async () => 0),
			exists: jest.fn(async () => false),
			insertOne: jest.fn(async () => ({ ...suggestion, user })),
			insert: jest.fn(async () => ({ identifiers: [{ id: suggestion.id }] })),
			findOne: jest.fn(async () => suggestion),
			delete: jest.fn(async () => ({ affected: 1 })),
			...overrides?.suggestions,
		};
		const drive = {
			findOneBy: jest.fn(async () => file),
			...overrides?.drive,
		};
		const emoji = { id: '9abc000005', name: suggestion.name, originalUrl: emojiFile.url };
		const emojis = {
			findOneBy: jest.fn(async () => null),
			...overrides?.emojis,
		};
		const customEmoji = {
			checkDuplicate: jest.fn(async () => false),
			createEmoji: jest.fn(async () => emoji),
			...overrides?.customEmoji,
		};
		const driveService = {
			uploadFromUrl: jest.fn(async () => emojiFile),
			deleteFile: jest.fn(async () => undefined),
			...overrides?.driveService,
		};
		const logger = {
			error: jest.fn(),
		};
		const service = new EmojiSuggestionService(
			suggestions as any,
			drive as any,
			emojis as any,
			customEmoji as any,
			driveService as any,
			{ gen: jest.fn(() => suggestion.id) } as any,
			{ getLogger: jest.fn(() => logger) } as any,
		);

		return { service, suggestions, drive, emojis, customEmoji, driveService, logger, emoji };
	}

	test('submission only accepts an image owned by the proposer', async () => {
		const { service, suggestions, drive } = createService({
			drive: { findOneBy: jest.fn(async () => null) },
		});

		await expect(service.create({
			name: suggestion.name,
			fileId: file.id,
			category: null,
			aliases: [],
			license: null,
			localOnly: false,
			isSensitive: false,
		}, user as any)).resolves.toEqual({ ok: false, reason: 'noSuchFile' });

		expect(drive.findOneBy).toHaveBeenCalledWith({ id: file.id, userId: user.id });
		expect(suggestions.insertOne).not.toHaveBeenCalled();
	});

	test('a simultaneous duplicate submission returns a domain error', async () => {
		const driverError = Object.assign(new Error('duplicate key'), { code: '23505' });
		const duplicateError = new QueryFailedError('', [], driverError);
		const { service } = createService({
			suggestions: { insertOne: jest.fn(async () => { throw duplicateError; }) },
		});

		await expect(service.create({
			name: suggestion.name,
			fileId: file.id,
			category: null,
			aliases: [],
			license: null,
			localOnly: false,
			isSensitive: false,
		}, user as any)).resolves.toEqual({ ok: false, reason: 'duplicateSuggestion' });
	});

	test('acceptance consumes the suggestion and creates the emoji from a dedicated file', async () => {
		const { service, suggestions, drive, customEmoji, driveService, emoji } = createService();

		await expect(service.accept(suggestion.id, moderator as any)).resolves.toEqual({ ok: true, value: emoji });

		expect(suggestions.delete).toHaveBeenCalledWith({
			id: suggestion.id,
			userId: user.id,
			fileId: file.id,
		});
		expect(driveService.uploadFromUrl).toHaveBeenCalledWith({
			url: file.url,
			user: null,
			force: true,
		});
		expect(customEmoji.createEmoji).toHaveBeenCalledWith({
			originalUrl: emojiFile.url,
			publicUrl: emojiFile.webpublicUrl,
			name: suggestion.name,
			category: suggestion.category,
			aliases: suggestion.aliases,
			host: null,
			license: suggestion.license,
			isSensitive: suggestion.isSensitive,
			localOnly: suggestion.localOnly,
			roleIdsThatCanBeUsedThisEmojiAsReaction: [],
		}, { moderator });
		expect(drive.findOneBy).not.toHaveBeenCalled();
		expect(suggestions.insert).not.toHaveBeenCalled();
	});

	test('a lost suggestion claim cannot create a second emoji', async () => {
		const { service, customEmoji, suggestions, driveService } = createService({
			suggestions: { delete: jest.fn(async () => ({ affected: 0 })) },
		});

		await expect(service.accept(suggestion.id, moderator as any)).resolves.toEqual({ ok: false, reason: 'noSuchSuggestion' });
		expect(customEmoji.createEmoji).not.toHaveBeenCalled();
		expect(driveService.uploadFromUrl).not.toHaveBeenCalled();
		expect(suggestions.insert).not.toHaveBeenCalled();
	});

	test('cancellation cannot succeed after acceptance has consumed the suggestion', async () => {
		let pending = true;
		let releaseCopy!: () => void;
		let markCopyStarted!: () => void;
		const copyStarted = new Promise<void>(resolve => {
			markCopyStarted = resolve;
		});
		const copying = new Promise<typeof emojiFile>(resolve => {
			releaseCopy = () => resolve(emojiFile);
		});
		const { service } = createService({
			suggestions: {
				delete: jest.fn(async () => {
					if (!pending) return { affected: 0 };
					pending = false;
					return { affected: 1 };
				}),
			},
			driveService: {
				uploadFromUrl: jest.fn(async () => {
					markCopyStarted();
					return await copying;
				}),
			},
		});

		const accepting = service.accept(suggestion.id, moderator as any);
		await copyStarted;
		await expect(service.cancel(suggestion.id, user as any)).resolves.toBe(false);
		releaseCopy();
		await expect(accepting).resolves.toEqual({ ok: true, value: expect.objectContaining({ id: '9abc000005' }) });
	});

	test('a failed emoji creation deletes its copy and restores the suggestion', async () => {
		const failure = new Error('creation failed');
		const { service, suggestions, driveService } = createService({
			customEmoji: { createEmoji: jest.fn(async () => { throw failure; }) },
		});

		await expect(service.accept(suggestion.id, moderator as any)).rejects.toBe(failure);
		expect(driveService.deleteFile).toHaveBeenCalledWith(emojiFile, false, moderator);
		expect(suggestions.insert).toHaveBeenCalledWith({
			id: suggestion.id,
			userId: user.id,
			fileId: file.id,
			name: suggestion.name,
			category: suggestion.category,
			aliases: suggestion.aliases,
			license: suggestion.license,
			localOnly: suggestion.localOnly,
			isSensitive: suggestion.isSensitive,
		});
	});

	test('cleanup failures do not mask a duplicate-name result', async () => {
		const driverError = Object.assign(new Error('duplicate key'), { code: '23505' });
		const duplicateError = new QueryFailedError('', [], driverError);
		const deleteFailure = new Error('copy deletion failed');
		const restoreFailure = new Error('suggestion restoration failed');
		const { service, suggestions, driveService, logger } = createService({
			suggestions: { insert: jest.fn(async () => { throw restoreFailure; }) },
			customEmoji: { createEmoji: jest.fn(async () => { throw duplicateError; }) },
			driveService: { deleteFile: jest.fn(async () => { throw deleteFailure; }) },
		});

		await expect(service.accept(suggestion.id, moderator as any)).resolves.toEqual({ ok: false, reason: 'duplicateName' });
		expect(driveService.deleteFile).toHaveBeenCalledWith(emojiFile, false, moderator);
		expect(suggestions.insert).toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledTimes(2);
	});

	test('a post-insert hook failure is treated as an accepted suggestion', async () => {
		const failure = new Error('broadcast failed');
		const insertedEmoji = { id: '9abc000005', name: suggestion.name, originalUrl: emojiFile.url };
		const { service, suggestions, emojis, driveService } = createService({
			emojis: { findOneBy: jest.fn(async () => insertedEmoji) },
			customEmoji: { createEmoji: jest.fn(async () => { throw failure; }) },
		});

		await expect(service.accept(suggestion.id, moderator as any)).resolves.toEqual({ ok: true, value: insertedEmoji });
		expect(emojis.findOneBy).toHaveBeenCalledWith({
			name: suggestion.name,
			host: IsNull(),
			originalUrl: emojiFile.url,
		});
		expect(driveService.deleteFile).not.toHaveBeenCalled();
		expect(suggestions.insert).not.toHaveBeenCalled();
	});
});
