/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import { ExportAccountDataProcessorService } from '@/queue/processors/ExportAccountDataProcessorService.js';
import { ExportClipsProcessorService } from '@/queue/processors/ExportClipsProcessorService.js';
import { ExportFavoritesProcessorService } from '@/queue/processors/ExportFavoritesProcessorService.js';

describe('export visibility ACLs', () => {
	const user = { id: 'user-a', host: null };
	const visibleNote = {
		id: 'note-visible',
		text: 'exportable text',
		hasPoll: false,
		fileIds: [],
		replyId: null,
		renoteId: null,
		cw: null,
		visibility: 'public',
		visibleUserIds: [],
		localOnly: false,
		reactionAcceptance: null,
		uri: null,
		url: null,
		user: { id: 'author-a', name: null, username: 'author', host: null, uri: null },
	};
	const hiddenNote = {
		...visibleNote,
		id: 'note-hidden',
		text: 'secret text',
		hasPoll: true,
		visibility: 'specified',
	};

	function createVisibilityService() {
		return {
			checkNoteVisibilityAsync: jest.fn(async (note: { id: string }) => note.id === hiddenNote.id
				? { accessible: false, redact: true, silence: false }
				: { accessible: true, redact: false, silence: false }),
		};
	}

	function createLoggerService() {
		return {
			logger: {
				createSubLogger: jest.fn(() => ({
					debug: jest.fn(),
					info: jest.fn(),
					error: jest.fn(),
				})),
			},
		};
	}

	test('clip export skips notes that are no longer visible to the exporting user', async () => {
		const visibilityService = createVisibilityService();
		const writtenChunks: string[] = [];
		const writer = {
			write: jest.fn(async (chunk: string) => {
				writtenChunks.push(chunk);
			}),
		};
		const clipNoteBatches = [
			[
				{ id: 'clip-note-a', clipId: 'clip-a', note: hiddenNote },
				{ id: 'clip-note-b', clipId: 'clip-a', note: visibleNote },
			],
			[],
		];
		const clipNotesRepository = {
			find: jest.fn(async () => clipNoteBatches.shift() ?? []),
		};
		const pollsRepository = {
			findOneByOrFail: jest.fn(async () => ({ choices: ['secret'] })),
		};
		const idService = {
			parse: jest.fn(() => ({ date: new Date('2026-05-17T00:00:00.000Z') })),
		};
		const service = new ExportClipsProcessorService(
			{} as any,
			pollsRepository as any,
			{} as any,
			clipNotesRepository as any,
			{} as any,
			createLoggerService() as any,
			idService as any,
			{} as any,
			visibilityService as any,
			{} as any,
		);

		await service.processClipNotes(writer as any, 'clip-a', user as any);

		expect(visibilityService.checkNoteVisibilityAsync).toHaveBeenCalledWith(hiddenNote, user);
		expect(visibilityService.checkNoteVisibilityAsync).toHaveBeenCalledWith(visibleNote, user);
		expect(pollsRepository.findOneByOrFail).not.toHaveBeenCalled();
		expect(writer.write).toHaveBeenCalledTimes(1);
		expect(writtenChunks[0]).toContain('exportable text');
		expect(writtenChunks[0]).not.toContain('secret text');
	});

	test.each([
		['account data', ExportAccountDataProcessorService],
		['favorites', ExportFavoritesProcessorService],
		['clips', ExportClipsProcessorService],
	])('%s export rejects inaccessible or redacted notes', async (_name, Service) => {
		const visibilityService = createVisibilityService();
		const service = Object.create(Service.prototype);
		service.noteVisibilityService = visibilityService;

		await expect(service.canExportNote(hiddenNote, user)).resolves.toBe(false);
		await expect(service.canExportNote(visibleNote, user)).resolves.toBe(true);
	});
});
