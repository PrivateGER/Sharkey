/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import { QueryFailedError } from 'typeorm';
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
		type: 'image/png',
		isSensitive: true,
	};
	const suggestion = {
		id: '9abc000004',
		userId: user.id,
		fileId: file.id,
		file,
		remoteEmojiId: null,
		remoteEmojiUrl: null,
		remoteEmojiHost: null,
		name: 'party_blob',
		category: 'Blobs',
		aliases: ['party'],
		license: 'CC0',
		localOnly: false,
		isSensitive: false,
	};
	const remoteSuggestion = {
		...suggestion,
		fileId: null,
		file: null,
		remoteEmojiId: remoteEmoji.id,
		remoteEmojiUrl: remoteEmoji.originalUrl,
		remoteEmojiHost: remoteEmoji.host,
	};

	function createService(overrides?: {
		initialSuggestion?: Record<string, unknown>;
		suggestions?: Record<string, unknown>;
		transactionalSuggestions?: Record<string, unknown>;
		drive?: Record<string, unknown>;
		emojis?: Record<string, unknown>;
		customEmoji?: Record<string, unknown>;
		driveService?: Record<string, unknown>;
		notificationService?: Record<string, unknown>;
		roleService?: Record<string, unknown>;
		globalEventService?: Record<string, unknown>;
		utilityService?: Record<string, unknown>;
		idValues?: string[];
	}) {
		let storedSuggestion: Record<string, unknown> | null = {
			...suggestion,
			...overrides?.initialSuggestion,
		};
		let insertedSuggestion: Record<string, unknown> | null = null;
		const matches = (criteria: Record<string, unknown> | string): boolean => {
			if (storedSuggestion == null) return false;
			if (typeof criteria === 'string') return storedSuggestion.id === criteria;
			return Object.entries(criteria).every(([key, value]) => storedSuggestion![key] === value);
		};
		const transactionalSuggestions = {
			countBy: jest.fn(async () => 0),
			exists: jest.fn(async () => false),
			insert: jest.fn(async (data: Record<string, unknown>) => {
				insertedSuggestion = {
					...suggestion,
					...data,
					file: data.fileId == null ? null : file,
					user,
				};
				storedSuggestion = insertedSuggestion;
				return { identifiers: [{ id: data.id }] };
			}),
			...overrides?.transactionalSuggestions,
		};
		const manager = {
			query: jest.fn(async () => undefined),
			getRepository: jest.fn(() => transactionalSuggestions),
		};
		const db = {
			transaction: jest.fn(async (callback: (transactionManager: typeof manager) => Promise<unknown>) => await callback(manager)),
		};
		const suggestions = {
			findOneOrFail: jest.fn(async () => insertedSuggestion ?? storedSuggestion),
			findOne: jest.fn(async () => storedSuggestion),
			insert: jest.fn(async (data: Record<string, unknown>) => {
				storedSuggestion = { ...suggestion, ...data };
				return { identifiers: [{ id: data.id }] };
			}),
			delete: jest.fn(async (criteria: Record<string, unknown> | string) => {
				if (!matches(criteria)) return { affected: 0 };
				storedSuggestion = null;
				return { affected: 1 };
			}),
			...overrides?.suggestions,
		};
		const drive = {
			findOneBy: jest.fn(async () => file),
			...overrides?.drive,
		};
		const emoji = { id: '9abc000009', name: suggestion.name, originalUrl: emojiFile.url };
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
			deleteFile: jest.fn(async () => undefined),
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
		const utilityService = {
			isBlockedHost: jest.fn(() => false),
			...overrides?.utilityService,
		};
		const logger = {
			error: jest.fn(),
		};
		const generatedIds = [...(overrides?.idValues ?? ['9abc000009'])];
		const idService = {
			gen: jest.fn(() => generatedIds.shift() ?? '9abc000009'),
		};
		const dependencies = [
			suggestions,
			drive,
			emojis,
			db,
			customEmoji,
			driveService,
			notificationService,
			roleService,
			globalEventService,
			utilityService,
			idService,
			{ getLogger: jest.fn(() => logger) },
		] as unknown as ConstructorParameters<typeof EmojiSuggestionService>;
		const service = new EmojiSuggestionService(...dependencies);

		return {
			service,
			suggestions,
			transactionalSuggestions,
			manager,
			db,
			drive,
			emojis,
			customEmoji,
			driveService,
			notificationService,
			roleService,
			globalEventService,
			utilityService,
			idService,
			logger,
			emoji,
			getStoredSuggestion: () => storedSuggestion,
		};
	}

	test('submission only accepts an image owned by the proposer', async () => {
		const { service, drive, transactionalSuggestions } = createService({
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
		expect(transactionalSuggestions.insert).not.toHaveBeenCalled();
	});

	test('submission records a cached remote emoji transactionally without downloading it', async () => {
		const { service, db, manager, transactionalSuggestions, driveService } = createService({
			idValues: [suggestion.id],
		});

		await expect(service.create({
			name: suggestion.name,
			remoteEmojiId: remoteEmoji.id,
			category: suggestion.category,
			aliases: suggestion.aliases,
			license: suggestion.license,
			localOnly: false,
			isSensitive: true,
		}, proposer)).resolves.toEqual({
			ok: true,
			value: {
				...remoteSuggestion,
				isSensitive: true,
				user,
			},
		});

		expect(db.transaction).toHaveBeenCalledTimes(1);
		expect(manager.query).toHaveBeenCalledWith(
			'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
			[`emoji-suggestion:${user.id}`],
		);
		expect(manager.getRepository).toHaveBeenCalledTimes(1);
		expect(transactionalSuggestions.insert).toHaveBeenCalledWith({
			id: suggestion.id,
			userId: user.id,
			fileId: null,
			remoteEmojiId: remoteEmoji.id,
			remoteEmojiUrl: remoteEmoji.originalUrl,
			remoteEmojiHost: remoteEmoji.host,
			name: suggestion.name,
			category: suggestion.category,
			aliases: suggestion.aliases,
			license: suggestion.license,
			localOnly: false,
			isSensitive: true,
		});
		expect(driveService.uploadFromUrl).not.toHaveBeenCalled();
	});

	test('submission rejects remote emojis from blocked instances', async () => {
		const { service, driveService, transactionalSuggestions, utilityService } = createService({
			utilityService: { isBlockedHost: jest.fn(() => true) },
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

		expect(utilityService.isBlockedHost).toHaveBeenCalledWith(remoteEmoji.host);
		expect(driveService.uploadFromUrl).not.toHaveBeenCalled();
		expect(transactionalSuggestions.insert).not.toHaveBeenCalled();
	});

	test('submission rejects a cached remote non-image without downloading it', async () => {
		const { service, driveService, transactionalSuggestions } = createService({
			customEmoji: {
				emojisByIdCache: {
					fetchMaybe: jest.fn(async () => ({ ...remoteEmoji, type: 'application/octet-stream' })),
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
		}, proposer)).resolves.toEqual({ ok: false, reason: 'unsupportedFileType' });

		expect(driveService.uploadFromUrl).not.toHaveBeenCalled();
		expect(transactionalSuggestions.insert).not.toHaveBeenCalled();
	});

	test('submission enforces the pending cap inside the transaction', async () => {
		const { service, transactionalSuggestions, globalEventService } = createService({
			transactionalSuggestions: { countBy: jest.fn(async () => 20) },
		});

		await expect(service.create({
			name: suggestion.name,
			fileId: file.id,
			category: null,
			aliases: [],
			license: null,
			localOnly: false,
			isSensitive: false,
		}, proposer)).resolves.toEqual({ ok: false, reason: 'tooManyPendingSuggestions' });

		expect(transactionalSuggestions.countBy).toHaveBeenCalledWith({ userId: user.id });
		expect(transactionalSuggestions.exists).not.toHaveBeenCalled();
		expect(transactionalSuggestions.insert).not.toHaveBeenCalled();
		expect(globalEventService.publishAdminStream).not.toHaveBeenCalled();
	});

	test('submission detects an existing duplicate inside the transaction', async () => {
		const { service, transactionalSuggestions } = createService({
			transactionalSuggestions: { exists: jest.fn(async () => true) },
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

		expect(transactionalSuggestions.exists).toHaveBeenCalledWith({
			where: [{ name: suggestion.name }, { fileId: file.id }],
		});
		expect(transactionalSuggestions.insert).not.toHaveBeenCalled();
	});

	test('a simultaneous remote duplicate returns a domain error without downloading', async () => {
		const driverError = Object.assign(new Error('duplicate key'), { code: '23505' });
		const duplicateError = new QueryFailedError('', [], driverError);
		const { service, driveService } = createService({
			transactionalSuggestions: { insert: jest.fn(async () => { throw duplicateError; }) },
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

		expect(driveService.uploadFromUrl).not.toHaveBeenCalled();
	});

	test('a simultaneous local duplicate returns a domain error', async () => {
		const driverError = Object.assign(new Error('duplicate key'), { code: '23505' });
		const duplicateError = new QueryFailedError('', [], driverError);
		const { service } = createService({
			transactionalSuggestions: { insert: jest.fn(async () => { throw duplicateError; }) },
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

	test('a remote suggestion insert failure does not download the source', async () => {
		const failure = new Error('insert failed');
		const { service, driveService } = createService({
			transactionalSuggestions: { insert: jest.fn(async () => { throw failure; }) },
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

		expect(driveService.uploadFromUrl).not.toHaveBeenCalled();
	});

	test('submission rejects local emojis as remote sources without copying them', async () => {
		const { service, driveService, transactionalSuggestions } = createService({
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

		expect(driveService.uploadFromUrl).not.toHaveBeenCalled();
		expect(transactionalSuggestions.insert).not.toHaveBeenCalled();
	});

	test('submission publishes a queue change to every active emoji reviewer', async () => {
		const adminId = '9abc000007';
		const { service, notificationService, roleService, globalEventService } = createService({
			idValues: [suggestion.id],
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
			idValues: [suggestion.id],
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
		}, proposer)).resolves.toEqual({
			ok: true,
			value: expect.objectContaining({ id: suggestion.id, user }),
		});

		expect(notificationService.createNotification).not.toHaveBeenCalled();
		expect(globalEventService.publishAdminStream).not.toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('Failed to publish emoji suggestion queue update'),
		);
	});

	test('acceptance consumes the suggestion and creates the emoji from a dedicated file', async () => {
		const { service, suggestions, drive, customEmoji, driveService, notificationService, globalEventService, emoji } = createService();

		await expect(service.accept(suggestion.id, reviewer)).resolves.toEqual({ ok: true, value: emoji });

		expect(suggestions.delete).toHaveBeenCalledWith({ id: suggestion.id });
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
	});

	test('acceptance downloads a remote suggestion only after it is consumed', async () => {
		const acceptance = createService({
			initialSuggestion: remoteSuggestion,
		});
		acceptance.driveService.uploadFromUrl.mockImplementation(async () => {
			expect(acceptance.getStoredSuggestion()).toBeNull();
			return emojiFile;
		});

		await expect(acceptance.service.accept(remoteSuggestion.id, reviewer)).resolves.toEqual({
			ok: true,
			value: acceptance.emoji,
		});

		expect(acceptance.suggestions.delete).toHaveBeenCalledWith({ id: remoteSuggestion.id });
		expect(acceptance.driveService.uploadFromUrl).toHaveBeenCalledWith({
			url: remoteEmoji.originalUrl,
			user: null,
			force: true,
		});
		expect(acceptance.customEmoji.createEmoji).toHaveBeenCalled();
	});

	test('acceptance restores a remote suggestion if its instance becomes blocked', async () => {
		const { service, suggestions, driveService, getStoredSuggestion } = createService({
			initialSuggestion: remoteSuggestion,
			utilityService: { isBlockedHost: jest.fn(() => true) },
		});

		await expect(service.accept(remoteSuggestion.id, reviewer)).resolves.toEqual({
			ok: false,
			reason: 'noSuchRemoteEmoji',
		});

		expect(suggestions.insert).toHaveBeenCalledWith(expect.objectContaining({
			id: remoteSuggestion.id,
			remoteEmojiId: remoteEmoji.id,
			remoteEmojiUrl: remoteEmoji.originalUrl,
			remoteEmojiHost: remoteEmoji.host,
		}));
		expect(getStoredSuggestion()).toEqual(expect.objectContaining({ id: remoteSuggestion.id }));
		expect(driveService.uploadFromUrl).not.toHaveBeenCalled();
	});

	test('a lost suggestion claim cannot create a second emoji', async () => {
		const { service, customEmoji, driveService } = createService({
			suggestions: { delete: jest.fn(async () => ({ affected: 0 })) },
		});

		await expect(service.accept(suggestion.id, reviewer)).resolves.toEqual({ ok: false, reason: 'noSuchSuggestion' });
		expect(customEmoji.createEmoji).not.toHaveBeenCalled();
		expect(driveService.uploadFromUrl).not.toHaveBeenCalled();
	});

	test('cancellation cannot succeed after acceptance consumes the suggestion', async () => {
		let releaseCopy!: () => void;
		let markCopyStarted!: () => void;
		const copyStarted = new Promise<void>(resolve => {
			markCopyStarted = resolve;
		});
		const copying = new Promise<typeof emojiFile>(resolve => {
			releaseCopy = () => resolve(emojiFile);
		});
		const { service } = createService({
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
		await expect(accepting).resolves.toEqual({ ok: true, value: expect.objectContaining({ id: '9abc000009' }) });
	});

	test('cancellation and rejection publish queue changes only after removal', async () => {
		const cancelled = createService();
		const rejected = createService();

		await expect(cancelled.service.cancel(suggestion.id, proposer)).resolves.toBe(true);
		await expect(rejected.service.reject(suggestion.id)).resolves.toBe(true);

		expect(cancelled.globalEventService.publishAdminStream).toHaveBeenCalledTimes(1);
		expect(rejected.globalEventService.publishAdminStream).toHaveBeenCalledTimes(1);
	});

	test('a failed emoji creation deletes its copy and restores the suggestion', async () => {
		const failure = new Error('creation failed');
		const { service, suggestions, driveService, notificationService, getStoredSuggestion } = createService({
			customEmoji: { createEmoji: jest.fn(async () => { throw failure; }) },
		});

		await expect(service.accept(suggestion.id, reviewer)).rejects.toBe(failure);

		expect(driveService.deleteFile).toHaveBeenCalledWith(emojiFile, false, moderator);
		expect(suggestions.insert).toHaveBeenCalledWith(expect.objectContaining({
			id: suggestion.id,
			fileId: file.id,
			remoteEmojiId: null,
		}));
		expect(getStoredSuggestion()).toEqual(expect.objectContaining({ id: suggestion.id }));
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
		const insertedEmoji = { id: '9abc000009', name: suggestion.name, originalUrl: emojiFile.url };
		const { service, emojis, driveService, notificationService } = createService({
			emojis: { findOneBy: jest.fn(async () => insertedEmoji) },
			customEmoji: { createEmoji: jest.fn(async () => { throw failure; }) },
		});

		await expect(service.accept(suggestion.id, reviewer)).resolves.toEqual({ ok: true, value: insertedEmoji });
		expect(emojis.findOneBy).toHaveBeenCalledWith({
			name: suggestion.name,
			host: expect.anything(),
			originalUrl: emojiFile.url,
		});
		expect(driveService.deleteFile).not.toHaveBeenCalled();
		expect(notificationService.createNotification).toHaveBeenCalledWith(user.id, 'emojiSuggestionAccepted', {
			emojiName: suggestion.name,
		});
	});
});
