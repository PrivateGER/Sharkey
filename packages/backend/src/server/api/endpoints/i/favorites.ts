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
import type { Packed } from '@/misc/json-schema.js';

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
		query: { type: 'string', nullable: true, description: 'Case-insensitive substring match against the note text and content warning.' },
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
			// Content filters must not match notes the caller can no longer read, or searches would leak their contents.
			const search = ps.query?.trim();
			const filtersContent = !!search || ps.withFiles;

			const fetchFavorites = (sinceId: string | undefined, untilId: string | undefined) => {
				const query = this.queryService.makePaginationQuery(this.noteFavoritesRepository.createQueryBuilder('favorite'), sinceId, untilId)
					.andWhere('favorite.userId = :meId', { meId: me.id })
					.innerJoinAndSelect('favorite.note', 'note');

				if (filtersContent) {
					this.queryService.generateVisibilityQuery(query, me);
				}

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

				return query.limit(ps.limit).getMany() as Promise<(MiNoteFavorite & { note: MiNote })[]>;
			};

			if (!filtersContent) {
				return await this.noteFavoriteEntityService.packMany(await fetchFavorites(ps.sinceId, ps.untilId), me);
			}

			// Packing hides more than the visibility query excludes (blocks, suspensions, …). Refill past hidden entries,
			// since an empty page reads as the end of the list.
			const ascending = ps.sinceId != null && ps.untilId == null;
			let sinceId = ps.sinceId;
			let untilId = ps.untilId;
			const visible: Packed<'NoteFavorite'>[] = [];
			for (;;) {
				const favorites = await fetchFavorites(sinceId, untilId);
				const packed = await this.noteFavoriteEntityService.packMany(favorites, me);
				visible.push(...packed.filter(favorite => !favorite.note.isHidden));

				const last = favorites.at(-1);
				if (visible.length >= ps.limit || favorites.length < ps.limit || !last) break;
				if (ascending) sinceId = last.id;
				else untilId = last.id;
			}
			return visible.slice(0, ps.limit);
		});
	}
}
