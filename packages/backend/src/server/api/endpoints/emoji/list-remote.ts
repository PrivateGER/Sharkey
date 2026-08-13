/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { EmojisRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { EmojiEntityService } from '@/core/entities/EmojiEntityService.js';
import { DI } from '@/di-symbols.js';
import { sqlLikeEscape } from '@/misc/sql-like-escape.js';

export const meta = {
	tags: ['emoji-suggestions'],
	requireCredential: true,
	kind: 'read:account',
	limit: {
		duration: 1000 * 5,
		max: 10,
	},
	res: {
		type: 'array',
		optional: false,
		nullable: false,
		items: {
			type: 'object',
			optional: false,
			nullable: false,
			ref: 'EmojiDetailed',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		query: { type: 'string', nullable: true, default: null },
		host: { type: 'string', nullable: true, default: null },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.emojisRepository)
		private readonly emojisRepository: EmojisRepository,

		private readonly queryService: QueryService,
		private readonly emojiEntityService: EmojiEntityService,
	) {
		super(meta, paramDef, async (ps) => {
			const query = this.queryService.makePaginationQuery(
				this.emojisRepository.createQueryBuilder('emoji'),
				ps.sinceId,
				ps.untilId,
			).andWhere('emoji.host IS NOT NULL');

			if (ps.query) {
				const names = ps.query
					.normalize('NFC')
					.split(/\s/)
					.filter(value => value.length > 0)
					.map(value => `%${sqlLikeEscape(value)}%`);
				query.andWhere('emoji.name ~~ ANY(ARRAY[:...names])', { names });
			}

			if (ps.host) {
				const hosts = ps.host
					.split(/\s/)
					.filter(value => value.length > 0)
					.map(value => `%${sqlLikeEscape(value)}%`);
				query.andWhere('emoji.host ~~ ANY(ARRAY[:...hosts])', { hosts });
			}

			const emojis = await query
				.take(ps.limit)
				.getMany();

			return await this.emojiEntityService.packDetailedMany(emojis);
		});
	}
}
