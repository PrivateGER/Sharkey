/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type {
	DriveFilesRepository,
	EmojisRepository,
	EmojiSuggestionsRepository,
	MiDriveFile,
	MiEmoji,
	MiEmojiSuggestion,
	MiUser,
} from '@/models/_.js';
import { FILE_TYPE_IMAGE } from '@/const.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { DriveService } from '@/core/DriveService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import type Logger from '@/logger.js';

export const MAX_PENDING_EMOJI_SUGGESTIONS = 20;

export type EmojiSuggestionError =
	| 'duplicateName'
	| 'duplicateSuggestion'
	| 'noSuchFile'
	| 'noSuchSuggestion'
	| 'tooManyPendingSuggestions'
	| 'unsupportedFileType';

export type EmojiSuggestionResult<T> =
	| { ok: true, value: T }
	| { ok: false, reason: EmojiSuggestionError };

export type CreateEmojiSuggestionOptions = {
	name: string;
	fileId: string;
	category: string | null;
	aliases: string[];
	license: string | null;
	localOnly: boolean;
	isSensitive: boolean;
};

@Injectable()
export class EmojiSuggestionService {
	private readonly logger: Logger;

	constructor(
		@Inject(DI.emojiSuggestionsRepository)
		private readonly emojiSuggestionsRepository: EmojiSuggestionsRepository,

		@Inject(DI.driveFilesRepository)
		private readonly driveFilesRepository: DriveFilesRepository,

		@Inject(DI.emojisRepository)
		private readonly emojisRepository: EmojisRepository,

		private readonly customEmojiService: CustomEmojiService,
		private readonly driveService: DriveService,
		private readonly idService: IdService,
		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('emoji-suggestion');
	}

	@bindThis
	public async create(
		options: CreateEmojiSuggestionOptions,
		user: MiUser,
	): Promise<EmojiSuggestionResult<MiEmojiSuggestion>> {
		const name = options.name.normalize('NFC');
		const file = await this.driveFilesRepository.findOneBy({
			id: options.fileId,
			userId: user.id,
		});
		if (file == null) return { ok: false, reason: 'noSuchFile' };
		if (!FILE_TYPE_IMAGE.includes(file.type)) return { ok: false, reason: 'unsupportedFileType' };
		if (await this.customEmojiService.checkDuplicate(name)) return { ok: false, reason: 'duplicateName' };

		const [pendingCount, duplicateSuggestion] = await Promise.all([
			this.emojiSuggestionsRepository.countBy({ userId: user.id }),
			this.emojiSuggestionsRepository.exists({
				where: [
					{ userId: user.id, name },
					{ fileId: file.id },
				],
			}),
		]);
		if (pendingCount >= MAX_PENDING_EMOJI_SUGGESTIONS) return { ok: false, reason: 'tooManyPendingSuggestions' };
		if (duplicateSuggestion) return { ok: false, reason: 'duplicateSuggestion' };

		let suggestion: MiEmojiSuggestion;
		try {
			suggestion = await this.emojiSuggestionsRepository.insertOne({
				id: this.idService.gen(),
				userId: user.id,
				fileId: file.id,
				name,
				category: options.category?.normalize('NFC') ?? null,
				aliases: options.aliases.map(alias => alias.normalize('NFC')),
				license: options.license,
				localOnly: options.localOnly,
				isSensitive: options.isSensitive,
			}, {
				relations: {
					file: true,
					user: true,
				},
			});
		} catch (error) {
			// The preflight check gives a useful early response, while the unique
			// constraints close the race between simultaneous submissions.
			if (isDuplicateKeyValueError(error)) return { ok: false, reason: 'duplicateSuggestion' };
			throw error;
		}

		return { ok: true, value: suggestion };
	}

	@bindThis
	public async accept(
		suggestionId: string,
		moderator: MiUser,
	): Promise<EmojiSuggestionResult<MiEmoji>> {
		const suggestion = await this.emojiSuggestionsRepository.findOne({
			where: { id: suggestionId },
			relations: { file: true },
		});
		if (suggestion == null) return { ok: false, reason: 'noSuchSuggestion' };

		// Consume the suggestion before doing any work. This makes acceptance,
		// cancellation, rejection, and another acceptance mutually exclusive.
		const claimed = await this.emojiSuggestionsRepository.delete({
			id: suggestion.id,
			userId: suggestion.userId,
			fileId: suggestion.fileId,
		});
		if (claimed.affected !== 1) return { ok: false, reason: 'noSuchSuggestion' };

		const restoreSuggestion = async () => {
			await this.emojiSuggestionsRepository.insert({
				id: suggestion.id,
				userId: suggestion.userId,
				fileId: suggestion.fileId,
				name: suggestion.name,
				category: suggestion.category,
				aliases: suggestion.aliases,
				license: suggestion.license,
				localOnly: suggestion.localOnly,
				isSensitive: suggestion.isSensitive,
			});
		};

		let isDuplicate: boolean;
		try {
			isDuplicate = await this.customEmojiService.checkDuplicate(suggestion.name);
		} catch (error) {
			await restoreSuggestion();
			throw error;
		}
		if (isDuplicate) {
			await restoreSuggestion();
			return { ok: false, reason: 'duplicateName' };
		}

		let emojiFile: MiDriveFile | undefined;
		try {
			// A suggestion may reference an avatar, banner, page image, or other
			// shared Drive row. Give the emoji its own system-owned copy so its
			// lifecycle cannot mutate or delete the proposer's original file.
			emojiFile = await this.driveService.uploadFromUrl({
				url: suggestion.file.url,
				user: null,
				force: true,
			});

			const emoji = await this.customEmojiService.createEmoji({
				originalUrl: emojiFile.url,
				publicUrl: emojiFile.webpublicUrl ?? emojiFile.url,
				name: suggestion.name,
				category: suggestion.category,
				aliases: suggestion.aliases,
				host: null,
				license: suggestion.license,
				isSensitive: suggestion.isSensitive,
				localOnly: suggestion.localOnly,
				roleIdsThatCanBeUsedThisEmojiAsReaction: [],
			}, { moderator });

			return { ok: true, value: emoji };
		} catch (error) {
			if (emojiFile != null) {
				// createEmoji inserts before publishing and moderation logging. If a
				// post-insert hook failed, the durable result is still an acceptance.
				const insertedEmoji = await this.emojisRepository.findOneBy({
					name: suggestion.name,
					host: IsNull(),
					originalUrl: emojiFile.url,
				});
				if (insertedEmoji != null) return { ok: true, value: insertedEmoji };

				try {
					await this.driveService.deleteFile(emojiFile, false, moderator);
				} catch (cleanupError) {
					this.logger.error(`Failed to delete the emoji file copy after acceptance failed: ${renderInlineError(cleanupError)}`);
				}
			}

			try {
				await restoreSuggestion();
			} catch (restoreError) {
				this.logger.error(`Failed to restore emoji suggestion ${suggestion.id} after acceptance failed: ${renderInlineError(restoreError)}`);
			}

			if (isDuplicateKeyValueError(error)) return { ok: false, reason: 'duplicateName' };
			throw error;
		}
	}

	@bindThis
	public async cancel(suggestionId: string, user: MiUser): Promise<boolean> {
		const result = await this.emojiSuggestionsRepository.delete({
			id: suggestionId,
			userId: user.id,
		});
		return result.affected === 1;
	}

	@bindThis
	public async reject(suggestionId: string): Promise<boolean> {
		const result = await this.emojiSuggestionsRepository.delete(suggestionId);
		return result.affected === 1;
	}
}
