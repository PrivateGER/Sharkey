/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import { IsNull, QueryFailedError } from 'typeorm';
import { EmojiSuggestionService } from '@/core/EmojiSuggestionService.js';
import type { MiUser } from '@/models/_.js';

describe('EmojiSuggestionService', () => {
	const user = { id: '9abc000001', username: 'proposer', host: null };
	const moderator = { id: '9abc000002', username: 'moderator', host: null };
	// These fixtures exercise service behavior and intentionally omit unrelated MiUser columns.
	const proposer = user as unknown as MiUser;
	const reviewer = moderator as unknown as MiUser;
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
	const remoteEmoji = {
		id: '9abc000008',
		name: 'party_blob',
		host: 'remote.example',
		originalUrl: 'https://remote.example/emoji.png',
		isSensitive: true,
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
		notificationService?: Record<string, unknown>;
		roleService?: Record<string, unknown>;
		globalEventService?: Record<string, unknown>;
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
			emojisByIdCache: {
				fetchMaybe: jest.fn(async () => remoteEmoji),
			},
			...overrides?.customEmoji,
		};
		const driveService = {
			uploadFromUrl: jest.fn(async () => emojiFile),
			uploadFromUrlWithResult: jest.fn(async () => ({ file: emojiFile, isNew: true })),
			deleteFile: jest.fn(async () => undefined),
			deleteFileSync: jest.fn(async () => undefined),
			...overrides?.driveService,
		};
		const notificationService = {
			createNotification: jest.fn(),
			...overrides?.notificationService,
		};
		const roleService = {
			getModeratorIds: jest.fn(async () => [moderator.id]),
			...overrides?.roleService,
		};
		const globalEventService = {
			publishAdminStream: jest.fn(async () => undefined),
			...overrides?.globalEventService,
		};
		const logger = {
			error: jest.fn(),
		};
		// Each test double implements only the dependency methods exercised by this unit.
		const dependencies = [
			suggestions,
			drive,
			emojis,
			customEmoji,
			driveService,
			notificationService,
			roleService,
			globalEventService,
			{ gen: jest.fn(() => suggestion.id) },
			{ getLogger: jest.fn(() => logger) },
		] as unknown as ConstructorParameters<typeof EmojiSuggestionService>;
		const service = new EmojiSuggestionService(...dependencies);

		return { service, suggestions, drive, emojis, customEmoji, driveService, notificationService, roleService, globalEventService, logger, emoji };
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
		}, proposer)).resolves.toEqual({ ok: false, reason: 'noSuchFile' });

		expect(drive.findOneBy).toHaveBeenCalledWith({ id: file.id, userId: user.id });
		expect(suggestions.insertOne).not.toHaveBeenCalled();
	});

	test('submission can copy a cached remote emoji into the proposer Drive', async () => {
		const remoteFile = {
			...file,
			id: '9abc000009',
			url: 'https://example.test/copied-remote.png',
			isSensitive: true,
		};
		const { service, driveService, suggestions } = createService({
			driveService: { uploadFromUrlWithResult: jest.fn(async () => ({ file: remoteFile, isNew: true })) },
		});

		await expect(service.create({
			name: suggestion.name,
			remoteEmojiId: remoteEmoji.id,
			category: suggestion.category,
			aliases: suggestion.aliases,
			license: suggestion.license,
			localOnly: false,
			isSensitive: true,
		}, proposer)).resolves.toEqual({ ok: true, value: { ...suggestion, user } });

		expect(driveService.uploadFromUrlWithResult).toHaveBeenCalledWith({
			url: remoteEmoji.originalUrl,
			user: proposer,
			sensitive: true,
		});
		expect(suggestions.insertOne).toHaveBeenCalledWith(
			expect.objectContaining({ userId: user.id, fileId: remoteFile.id }),
			expect.anything(),
		);
	});

	test('a rejected remote image removes its newly created Drive copy', async () => {
		const unsupportedFile = { ...emojiFile, type: 'application/octet-stream' };
		const { service, driveService, suggestions } = createService({
			driveService: {
				uploadFromUrlWithResult: jest.fn(async () => ({ file: unsupportedFile, isNew: true })),
			},
		});

		await expect(service.create({
			name: suggestion.name,
			remoteEmojiId: remoteEmoji.id,
			category: null,
			aliases: [],
			license: null,
			localOnly: false,
			isSensitive: false,
		}, proposer)).resolves.toEqual({ ok: false, reason: 'unsupportedFileType' });

		expect(driveService.deleteFileSync).toHaveBeenCalledWith(unsupportedFile);
		expect(suggestions.insertOne).not.toHaveBeenCalled();
	});

	test('a rejected remote image preserves a deduplicated Drive file', async () => {
		const unsupportedFile = { ...emojiFile, type: 'application/octet-stream' };
		const { service, driveService } = createService({
			driveService: {
				uploadFromUrlWithResult: jest.fn(async () => ({ file: unsupportedFile, isNew: false })),
			},
		});

		await expect(service.create({
			name: suggestion.name,
			remoteEmojiId: remoteEmoji.id,
			category: null,
			aliases: [],
			license: null,
			localOnly: false,
			isSensitive: false,
		}, proposer)).resolves.toEqual({ ok: false, reason: 'unsupportedFileType' });

		expect(driveService.deleteFileSync).not.toHaveBeenCalled();
	});

	test('a simultaneous remote duplicate removes its new Drive copy', async () => {
		const driverError = Object.assign(new Error('duplicate key'), { code: '23505' });
		const duplicateError = new QueryFailedError('', [], driverError);
		const { service, driveService } = createService({
			suggestions: { insertOne: jest.fn(async () => { throw duplicateError; }) },
		});

		await expect(service.create({
			name: suggestion.name,
			remoteEmojiId: remoteEmoji.id,
			category: null,
			aliases: [],
			license: null,
			localOnly: false,
			isSensitive: false,
		}, proposer)).resolves.toEqual({ ok: false, reason: 'duplicateSuggestion' });

		expect(driveService.deleteFileSync).toHaveBeenCalledWith(emojiFile);
	});

	test('a remote suggestion insert failure removes its new Drive copy', async () => {
		const failure = new Error('insert failed');
		const { service, driveService } = createService({
			suggestions: { insertOne: jest.fn(async () => { throw failure; }) },
		});

		await expect(service.create({
			name: suggestion.name,
			remoteEmojiId: remoteEmoji.id,
			category: null,
			aliases: [],
			license: null,
			localOnly: false,
			isSensitive: false,
		}, proposer)).rejects.toBe(failure);

		expect(driveService.deleteFileSync).toHaveBeenCalledWith(emojiFile);
	});

	test('submission rejects local emojis as remote sources without copying them', async () => {
		const { service, driveService, suggestions } = createService({
			customEmoji: {
				emojisByIdCache: {
					fetchMaybe: jest.fn(async () => ({ ...remoteEmoji, host: null })),
				},
			},
		});

		await expect(service.create({
			name: suggestion.name,
			remoteEmojiId: remoteEmoji.id,
			category: null,
			aliases: [],
			license: null,
			localOnly: false,
			isSensitive: false,
		}, proposer)).resolves.toEqual({ ok: false, reason: 'noSuchRemoteEmoji' });

		expect(driveService.uploadFromUrlWithResult).not.toHaveBeenCalled();
		expect(suggestions.insertOne).not.toHaveBeenCalled();
	});

	test('submission publishes a queue change to every active emoji reviewer', async () => {
		const adminId = '9abc000007';
		const { service, notificationService, roleService, globalEventService } = createService({
			roleService: { getModeratorIds: jest.fn(async () => [moderator.id, adminId]) },
		});

		await expect(service.create({
			name: suggestion.name,
			fileId: file.id,
			category: suggestion.category,
			aliases: suggestion.aliases,
			license: suggestion.license,
			localOnly: suggestion.localOnly,
			isSensitive: suggestion.isSensitive,
		}, proposer)).resolves.toEqual({ ok: true, value: { ...suggestion, user } });

		expect(roleService.getModeratorIds).toHaveBeenCalledWith({
			includeAdmins: true,
			includeRoot: true,
			excludeExpire: true,
		});
		expect(notificationService.createNotification).not.toHaveBeenCalled();
		expect(globalEventService.publishAdminStream).toHaveBeenCalledTimes(2);
		expect(globalEventService.publishAdminStream).toHaveBeenCalledWith(moderator.id, 'emojiSuggestionQueueChanged', {});
		expect(globalEventService.publishAdminStream).toHaveBeenCalledWith(adminId, 'emojiSuggestionQueueChanged', {});
	});

	test('a reviewer lookup failure does not discard a submitted suggestion', async () => {
		const failure = new Error('role lookup failed');
		const { service, logger, notificationService, globalEventService } = createService({
			roleService: { getModeratorIds: jest.fn(async () => { throw failure; }) },
		});

		await expect(service.create({
			name: suggestion.name,
			fileId: file.id,
			category: null,
			aliases: [],
			license: null,
			localOnly: false,
			isSensitive: false,
		}, proposer)).resolves.toEqual({ ok: true, value: { ...suggestion, user } });

		expect(notificationService.createNotification).not.toHaveBeenCalled();
		expect(globalEventService.publishAdminStream).not.toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('Failed to publish emoji suggestion queue update'),
		);
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
		}, proposer)).resolves.toEqual({ ok: false, reason: 'duplicateSuggestion' });
	});

	test('acceptance consumes the suggestion and creates the emoji from a dedicated file', async () => {
		const { service, suggestions, drive, customEmoji, driveService, notificationService, globalEventService, emoji } = createService();

		await expect(service.accept(suggestion.id, reviewer)).resolves.toEqual({ ok: true, value: emoji });

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
		expect(notificationService.createNotification).toHaveBeenCalledWith(user.id, 'emojiSuggestionAccepted', {
			emojiName: suggestion.name,
		});
		expect(globalEventService.publishAdminStream).toHaveBeenCalledWith(moderator.id, 'emojiSuggestionQueueChanged', {});
		expect(drive.findOneBy).not.toHaveBeenCalled();
		expect(suggestions.insert).not.toHaveBeenCalled();
	});

	test('a lost suggestion claim cannot create a second emoji', async () => {
		const { service, customEmoji, suggestions, driveService } = createService({
			suggestions: { delete: jest.fn(async () => ({ affected: 0 })) },
		});

		await expect(service.accept(suggestion.id, reviewer)).resolves.toEqual({ ok: false, reason: 'noSuchSuggestion' });
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

		const accepting = service.accept(suggestion.id, reviewer);
		await copyStarted;
		await expect(service.cancel(suggestion.id, proposer)).resolves.toBe(false);
		releaseCopy();
		await expect(accepting).resolves.toEqual({ ok: true, value: expect.objectContaining({ id: '9abc000005' }) });
	});

	test('cancellation and rejection publish queue changes only after removal', async () => {
		const { service, globalEventService } = createService();

		await expect(service.cancel(suggestion.id, proposer)).resolves.toBe(true);
		await expect(service.reject(suggestion.id)).resolves.toBe(true);

		expect(globalEventService.publishAdminStream).toHaveBeenCalledTimes(2);
	});

	test('a failed emoji creation deletes its copy and restores the suggestion', async () => {
		const failure = new Error('creation failed');
		const { service, suggestions, driveService, notificationService } = createService({
			customEmoji: { createEmoji: jest.fn(async () => { throw failure; }) },
		});

		await expect(service.accept(suggestion.id, reviewer)).rejects.toBe(failure);
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
		expect(notificationService.createNotification).not.toHaveBeenCalled();
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

		await expect(service.accept(suggestion.id, reviewer)).resolves.toEqual({ ok: false, reason: 'duplicateName' });
		expect(driveService.deleteFile).toHaveBeenCalledWith(emojiFile, false, moderator);
		expect(suggestions.insert).toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledTimes(2);
	});

	test('a post-insert hook failure is treated as an accepted suggestion', async () => {
		const failure = new Error('broadcast failed');
		const insertedEmoji = { id: '9abc000005', name: suggestion.name, originalUrl: emojiFile.url };
		const { service, suggestions, emojis, driveService, notificationService } = createService({
			emojis: { findOneBy: jest.fn(async () => insertedEmoji) },
			customEmoji: { createEmoji: jest.fn(async () => { throw failure; }) },
		});

		await expect(service.accept(suggestion.id, reviewer)).resolves.toEqual({ ok: true, value: insertedEmoji });
		expect(emojis.findOneBy).toHaveBeenCalledWith({
			name: suggestion.name,
			host: IsNull(),
			originalUrl: emojiFile.url,
		});
		expect(driveService.deleteFile).not.toHaveBeenCalled();
		expect(suggestions.insert).not.toHaveBeenCalled();
		expect(notificationService.createNotification).toHaveBeenCalledWith(user.id, 'emojiSuggestionAccepted', {
			emojiName: suggestion.name,
		});
	});
});
