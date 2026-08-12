/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { EmojiSuggestionService } from '@/core/EmojiSuggestionService.js';
import { EmojiEntityService } from '@/core/entities/EmojiEntityService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { emojiSuggestionErrors } from '@/server/api/emoji-suggestion.js';

export const meta = {
	tags: ['admin', 'emoji-suggestions'],
	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:emoji',
	errors: emojiSuggestionErrors,
	res: {
		type: 'object',
		ref: 'EmojiDetailed',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		suggestionId: { type: 'string', format: 'misskey:id' },
	},
	required: ['suggestionId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private readonly emojiSuggestionService: EmojiSuggestionService,
		private readonly emojiEntityService: EmojiEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const result = await this.emojiSuggestionService.accept(ps.suggestionId, me);
			if (!result.ok) throw new ApiError(meta.errors[result.reason]);

			return await this.emojiEntityService.packDetailed(result.value);
		});
	}
}
