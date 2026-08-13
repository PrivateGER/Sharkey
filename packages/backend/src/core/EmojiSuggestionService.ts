/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull, type DataSource } from 'typeorm';
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
import { MiEmojiSuggestion as EmojiSuggestion } from '@/models/EmojiSuggestion.js';
import { FILE_TYPE_IMAGE } from '@/const.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { DriveService } from '@/core/DriveService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { RoleService } from '@/core/RoleService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import type Logger from '@/logger.js';

export const MAX_PENDING_EMOJI_SUGGESTIONS = 20;

export type EmojiSuggestionError =
	| 'duplicateName'
	| 'duplicateSuggestion'
	| 'noSuchFile'
	| 'noSuchRemoteEmoji'
	| 'noSuchSuggestion'
	| 'tooManyPendingSuggestions'
	| 'unsupportedFileType';

export type EmojiSuggestionResult<T> =
	| { ok: true, value: T }
	| { ok: false, reason: EmojiSuggestionError };

type CreateEmojiSuggestionBaseOptions = {
	name: string;
	category: string | null;
	aliases: string[];
	license: string | null;
	localOnly: boolean;
	isSensitive: boolean;
};

export type CreateEmojiSuggestionOptions = CreateEmojiSuggestionBaseOptions & (
	| { fileId: string; remoteEmojiId?: never }
	| { fileId?: never; remoteEmojiId: string }
);

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
		@Inject(DI.db)
		private readonly db: DataSource,

		private readonly customEmojiService: CustomEmojiService,
		private readonly driveService: DriveService,
		private readonly notificationService: NotificationService,
		private readonly roleService: RoleService,
		private readonly globalEventService: GlobalEventService,
		private readonly utilityService: UtilityService,
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
		let file: MiDriveFile | null = null;
		let remoteSource: { id: string; url: string; host: string } | null = null;

		if (options.fileId != null) {
			file = await this.driveFilesRepository.findOneBy({
				id: options.fileId,
				userId: user.id,
			});
			if (file == null) return { ok: false, reason: 'noSuchFile' };
			if (!FILE_TYPE_IMAGE.includes(file.type)) return { ok: false, reason: 'unsupportedFileType' };
		} else {
			const emoji = await this.customEmojiService.emojisByIdCache.fetchMaybe(options.remoteEmojiId);
			if (
				emoji == null ||
				emoji.host == null ||
				this.utilityService.isBlockedHost(emoji.host)
			) {
				return { ok: false, reason: 'noSuchRemoteEmoji' };
			}
			if (emoji.type != null && !FILE_TYPE_IMAGE.includes(emoji.type)) {
				return { ok: false, reason: 'unsupportedFileType' };
			}
			remoteSource = {
				id: emoji.id,
				url: emoji.originalUrl,
				host: emoji.host,
			};
		}

		if (await this.customEmojiService.checkDuplicate(name)) {
			return { ok: false, reason: 'duplicateName' };
		}

		const suggestionId = this.idService.gen();
		let rejection: EmojiSuggestionError | null = null;
		try {
			await this.db.transaction(async manager => {
				// The lock makes the per-user cap exact without holding a transaction
				// during remote I/O; remote suggestions are not fetched on submission.
				await manager.query(
					'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
					[`emoji-suggestion:${user.id}`],
				);
				const repository = manager.getRepository(EmojiSuggestion);
				const pendingCount = await repository.countBy({ userId: user.id });
				if (pendingCount >= MAX_PENDING_EMOJI_SUGGESTIONS) {
					rejection = 'tooManyPendingSuggestions';
					return;
				}

				const duplicateSuggestion = await repository.exists({
					where: file != null ? [
						{ name },
						{ fileId: file.id },
					] : [
						{ name },
						{ remoteEmojiId: remoteSource!.id },
					],
				});
				if (duplicateSuggestion) {
					rejection = 'duplicateSuggestion';
					return;
				}

				await repository.insert({
					id: suggestionId,
					userId: user.id,
					fileId: file?.id ?? null,
					remoteEmojiId: remoteSource?.id ?? null,
					remoteEmojiUrl: remoteSource?.url ?? null,
					remoteEmojiHost: remoteSource?.host ?? null,
					name,
					category: options.category?.normalize('NFC') ?? null,
					aliases: options.aliases.map(alias => alias.normalize('NFC')),
					license: options.license,
					localOnly: options.localOnly,
					isSensitive: options.isSensitive,
				});
			});
		} catch (error) {
			// The transaction checks give useful responses, while the unique
			// constraints close races with submissions by other users.
			if (isDuplicateKeyValueError(error)) return { ok: false, reason: 'duplicateSuggestion' };
			throw error;
		}
		if (rejection != null) return { ok: false, reason: rejection };

		const suggestion = await this.emojiSuggestionsRepository.findOneOrFail({
			where: { id: suggestionId },
			relations: {
				file: true,
				user: true,
			},
		});
		await this.publishQueueChanged();

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

		const acceptedResult = async (emoji: MiEmoji): Promise<EmojiSuggestionResult<MiEmoji>> => {
			this.notificationService.createNotification(suggestion.userId, 'emojiSuggestionAccepted', {
				emojiName: suggestion.name,
			});
			await this.publishQueueChanged();
			return { ok: true, value: emoji };
		};

		// Consume the suggestion before doing any work. This keeps acceptance,
		// cancellation, rejection, and another acceptance mutually exclusive.
		const claimed = await this.emojiSuggestionsRepository.delete({ id: suggestion.id });
		if (claimed.affected !== 1) return { ok: false, reason: 'noSuchSuggestion' };

		const restoreSuggestion = async (): Promise<void> => {
			await this.emojiSuggestionsRepository.insert({
				id: suggestion.id,
				userId: suggestion.userId,
				fileId: suggestion.fileId,
				remoteEmojiId: suggestion.remoteEmojiId,
				remoteEmojiUrl: suggestion.remoteEmojiUrl,
				remoteEmojiHost: suggestion.remoteEmojiHost,
				name: suggestion.name,
				category: suggestion.category,
				aliases: suggestion.aliases,
				license: suggestion.license,
				localOnly: suggestion.localOnly,
				isSensitive: suggestion.isSensitive,
			});
		};

		if (
			suggestion.remoteEmojiHost != null &&
			this.utilityService.isBlockedHost(suggestion.remoteEmojiHost)
		) {
			await restoreSuggestion();
			return { ok: false, reason: 'noSuchRemoteEmoji' };
		}

		const sourceUrl = suggestion.file?.url ?? suggestion.remoteEmojiUrl;
		if (sourceUrl == null) {
			await restoreSuggestion();
			return { ok: false, reason: 'noSuchSuggestion' };
		}

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
			// Give the emoji its own system-owned file. Local suggestions may
			// reference shared Drive rows; remote suggestions are fetched only
			// after a moderator accepts them.
			emojiFile = await this.driveService.uploadFromUrl({
				url: sourceUrl,
				user: null,
				force: true,
			});

			if (!FILE_TYPE_IMAGE.includes(emojiFile.type)) {
				await this.driveService.deleteFile(emojiFile, false, moderator);
				emojiFile = undefined;
				await restoreSuggestion();
				return { ok: false, reason: 'unsupportedFileType' };
			}

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

			return await acceptedResult(emoji);
		} catch (error) {
			if (emojiFile != null) {
				// createEmoji inserts before publishing and moderation logging. If a
				// post-insert hook failed, the durable result is still an acceptance.
				const insertedEmoji = await this.emojisRepository.findOneBy({
					name: suggestion.name,
					host: IsNull(),
					originalUrl: emojiFile.url,
				});
				if (insertedEmoji != null) return await acceptedResult(insertedEmoji);

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
		if (result.affected === 1) await this.publishQueueChanged();
		return result.affected === 1;
	}

	@bindThis
	public async reject(suggestionId: string): Promise<boolean> {
		const result = await this.emojiSuggestionsRepository.delete(suggestionId);
		if (result.affected === 1) await this.publishQueueChanged();
		return result.affected === 1;
	}

	private async publishQueueChanged(): Promise<void> {
		try {
			const reviewerIds = await this.roleService.getModeratorIds({
				includeAdmins: true,
				includeRoot: true,
				excludeExpire: true,
			});
			await Promise.all(reviewerIds.map(reviewerId =>
				this.globalEventService.publishAdminStream(reviewerId, 'emojiSuggestionQueueChanged', {}),
			));
		} catch (error) {
			this.logger.error(`Failed to publish emoji suggestion queue update: ${renderInlineError(error)}`);
		}
	}
}
