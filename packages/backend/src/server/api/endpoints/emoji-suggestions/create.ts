/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { EmojiSuggestionService } from '@/core/EmojiSuggestionService.js';
import { EmojiSuggestionEntityService } from '@/core/entities/EmojiSuggestionEntityService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { emojiSuggestionErrors, emojiSuggestionParamDef } from '@/server/api/emoji-suggestion.js';

export const meta = {
	tags: ['emoji-suggestions'],
	requireCredential: true,
	kind: 'write:drive',
	limit: {
		duration: 1000 * 60,
		max: 10,
	},
	errors: emojiSuggestionErrors,
	res: {
		type: 'object',
		ref: 'EmojiSuggestion',
	},
} as const;

export const paramDef = emojiSuggestionParamDef;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private readonly emojiSuggestionService: EmojiSuggestionService,
		private readonly emojiSuggestionEntityService: EmojiSuggestionEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const source = ps.fileId != null
				? { fileId: ps.fileId }
				: { remoteEmojiId: ps.remoteEmojiId! };
			const result = await this.emojiSuggestionService.create({
				name: ps.name,
				...source,
				category: ps.category ?? null,
				aliases: ps.aliases ?? [],
				license: ps.license ?? null,
				isSensitive: ps.isSensitive ?? false,
				localOnly: ps.localOnly ?? false,
			}, me);
			if (!result.ok) throw new ApiError(meta.errors[result.reason]);

			return await this.emojiSuggestionEntityService.pack(result.value, me);
		});
	}
}
