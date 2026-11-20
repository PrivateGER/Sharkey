/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MiNote, MiNoteFavorite, NoteFavoritesRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteFavoriteEntityService } from '@/core/entities/NoteFavoriteEntityService.js';
import { sqlLikeEscape } from '@/misc/sql-like-escape.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['account', 'notes', 'favorites'],

	requireCredential: true,

	kind: 'read:favorites',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'NoteFavorite',
		},
	},

	// 10 calls per 5 seconds
	limit: {
		duration: 1000 * 5,
		max: 10,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		search: { type: 'string', nullable: true, description: 'Case-insensitive substring match against the note text and content warning.' },
		withFiles: { type: 'boolean', default: false },
		userId: { type: 'string', format: 'misskey:id', nullable: true, description: 'Only favorites of notes by this user.' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.noteFavoritesRepository)
		private noteFavoritesRepository: NoteFavoritesRepository,

		private noteFavoriteEntityService: NoteFavoriteEntityService,
		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(this.noteFavoritesRepository.createQueryBuilder('favorite'), ps.sinceId, ps.untilId)
				.andWhere('favorite.userId = :meId', { meId: me.id })
				.innerJoinAndSelect('favorite.note', 'note');

			const search = ps.search?.trim();
			if (search) {
				const pattern = `%${sqlLikeEscape(search)}%`;
				query.andWhere(new Brackets(qb => {
					qb.where('note.text ILIKE :pattern', { pattern })
						.orWhere('note.cw ILIKE :pattern', { pattern });
				}));
			}

			if (ps.withFiles) {
				query.andWhere('note.fileIds != \'{}\'');
			}

			if (ps.userId) {
				query.andWhere('note.userId = :userId', { userId: ps.userId });
			}

			const favorites = await query
				.limit(ps.limit)
				.getMany() as (MiNoteFavorite & { note: MiNote })[];

			return await this.noteFavoriteEntityService.packMany(favorites, me);
		});
	}
}
