/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { EmojiSuggestionService } from '@/core/EmojiSuggestionService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { emojiSuggestionErrors } from '@/server/api/emoji-suggestion.js';

export const meta = {
	tags: ['admin', 'emoji-suggestions'],
	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:emoji',
	errors: emojiSuggestionErrors,
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
	constructor(private readonly emojiSuggestionService: EmojiSuggestionService) {
		super(meta, paramDef, async (ps) => {
			if (!await this.emojiSuggestionService.reject(ps.suggestionId)) {
				throw new ApiError(meta.errors.noSuchSuggestion);
			}
		});
	}
}
