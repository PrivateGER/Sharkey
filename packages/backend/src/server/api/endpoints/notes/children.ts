/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Brackets } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import type { MiNote, MiUser, NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { DI } from '@/di-symbols.js';
import { ReplyBackfillService } from '@/core/ReplyBackfillService.js';
import { trackPromise } from '@/misc/promise-tracker.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},

	// Up to 25 calls, then 4 / second
	limit: {
		type: 'bucket',
		size: 25,
		dripRate: 250,
	},

	errors: {
		sortNotPaginatable: {
			message: 'sinceId and untilId can only be used with the newest sort.',
			code: 'SORT_NOT_PAGINATABLE',
			id: '6cf35866-f24e-446e-9d39-cdb2a5383661',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		showQuotes: { type: 'boolean', default: true },
		autoBackfill: {
			type: 'boolean',
			default: false,
			description: 'Also fetch newer replies of a remote note from its origin server in the background, if the server allows it and the thread is due. Newly imported replies are announced on the note\'s stream. Only honored for signed-in users.',
		},
		sort: {
			type: 'string',
			enum: ['newest', 'relationship'],
			default: 'newest',
			description: '`relationship` lists replies by the thread\'s author first, then the requester\'s own, then those by mutuals, then by users the requester follows, then everyone else; each group newest first. It can\'t be combined with sinceId or untilId.',
		},
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
		private readonly replyBackfillService: ReplyBackfillService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.sort === 'relationship' && (ps.sinceId != null || ps.untilId != null)) {
				throw new ApiError(meta.errors.sortNotPaginatable);
			}

			if (ps.autoBackfill && me != null) {
				trackPromise(this.replyBackfillService.requestAutomatic(ps.noteId, me));
			}

			const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), ps.sinceId, ps.untilId)
				.andWhere(new Brackets(qb => {
					qb.orWhere('note.replyId = :noteId');

					if (ps.showQuotes) {
						qb.orWhere(new Brackets(qbb => this.queryService
							.andIsQuote(qbb, 'note')
							.andWhere('note.renoteId = :noteId'),
						));
					}
				}))
				.innerJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser')
				.setParameters({ noteId: ps.noteId })
				.limit(ps.limit);

			await this.queryService.generateVisibilityQuery(query, me);
			this.queryService.generateBlockedHostQueryForNote(query);
			this.queryService.generateSuspendedUserQueryForNote(query);
			if (me) {
				this.queryService.generateMutedUserQueryForNotes(query, me);
				this.queryService.generateBlockedUserQueryForNotes(query, me);
			}

			if (ps.sort === 'relationship') {
				const rank = await this.relationshipRank(ps.noteId, me?.id ?? null);
				query.setParameters(rank.parameters)
					.orderBy(rank.expression, 'ASC')
					.addOrderBy('note.id', 'DESC');
			}

			const notes = await query.getMany();

			return await this.noteEntityService.packMany(notes, me);
		});
	}

	/**
	 * SQL expression ranking a reply by its author's relation to the thread and the viewer; lower ranks first.
	 */
	private async relationshipRank(noteId: MiNote['id'], meId: MiUser['id'] | null): Promise<{ expression: string, parameters: Record<string, string> }> {
		const parent = await this.notesRepository.findOne({ where: { id: noteId }, select: { id: true, userId: true, threadId: true } });
		const threadAuthorId = parent?.threadId == null
			? parent?.userId
			: (await this.notesRepository.findOne({ where: { id: parent.threadId }, select: { id: true, userId: true } }))?.userId;

		const cases: string[] = [];
		const parameters: Record<string, string> = {};
		if (threadAuthorId != null) {
			cases.push('WHEN "note"."userId" = :rankThreadAuthorId THEN 0');
			parameters.rankThreadAuthorId = threadAuthorId;
		}
		if (meId != null) {
			const follows = (followerId: string, followeeId: string) =>
				`EXISTS (SELECT 1 FROM "following" "rankFollowing" WHERE "rankFollowing"."followerId" = ${followerId} AND "rankFollowing"."followeeId" = ${followeeId})`;
			cases.push(
				'WHEN "note"."userId" = :rankMeId THEN 1',
				`WHEN ${follows(':rankMeId', '"note"."userId"')} THEN CASE WHEN ${follows('"note"."userId"', ':rankMeId')} THEN 2 ELSE 3 END`,
			);
			parameters.rankMeId = meId;
		}

		return {
			expression: cases.length > 0 ? `CASE ${cases.join(' ')} ELSE 4 END` : '4',
			parameters,
		};
	}
}
