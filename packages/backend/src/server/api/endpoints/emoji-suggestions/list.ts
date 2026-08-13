/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { EmojiSuggestionsRepository } from '@/models/_.js';
import { EmojiSuggestionEntityService } from '@/core/entities/EmojiSuggestionEntityService.js';
import { QueryService } from '@/core/QueryService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { emojiSuggestionListParamDef, emojiSuggestionListResponse } from '@/server/api/emoji-suggestion.js';

export const meta = {
	tags: ['emoji-suggestions'],
	requireCredential: true,
	kind: 'read:drive',
	res: emojiSuggestionListResponse,
} as const;

export const paramDef = emojiSuggestionListParamDef;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.emojiSuggestionsRepository)
		private readonly emojiSuggestionsRepository: EmojiSuggestionsRepository,
		private readonly emojiSuggestionEntityService: EmojiSuggestionEntityService,
		private readonly queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(
				this.emojiSuggestionsRepository.createQueryBuilder('suggestion'),
				ps.sinceId,
				ps.untilId,
			)
				.leftJoinAndSelect('suggestion.file', 'file')
				.innerJoinAndSelect('suggestion.user', 'user')
				.andWhere('suggestion.userId = :userId', { userId: me.id });

			const suggestions = await query.limit(ps.limit).getMany();
			return await this.emojiSuggestionEntityService.packMany(suggestions, me);
		});
	}
}
