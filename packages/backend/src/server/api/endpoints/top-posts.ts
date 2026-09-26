/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { NotesRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { IdService } from '@/core/IdService.js';
import { TimeService } from '@/global/TimeService.js';
import { rankTopPosts } from '@/misc/top-posts-ranking.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['notes'],

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				note: {
					type: 'object',
					optional: false, nullable: false,
					ref: 'Note',
				},
				score: {
					type: 'number',
					optional: false, nullable: false,
				},
				scoreExplanation: {
					type: 'object',
					optional: false, nullable: false,
				},
			},
		},
	},

	limit: {
		duration: 1000 * 60,
		max: 30,
		minInterval: 500,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
	},
	required: [],
} as const;

type CandidateRow = {
	noteId: string;
	authorId: string;
	renoters: number;
	repliers: number;
	reactors: number;
	engagers: number;
	isFollowingAuthor: boolean;
	followedEngagers: number;
};

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
		private idService: IdService,
		private timeService: TimeService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// Only authenticated local users can see their personalized top posts
			if (!me || me.host !== null) {
				throw new Error('Access denied: Only local users can view top posts');
			}

			// The materialized view holds globally interesting posts and their engagement stats.
			// Everything that depends on the viewer or on the current time is worked out here.
			const query = this.notesRepository.createQueryBuilder('note')
				.innerJoin('top_interesting_posts_for_local_users', 'top', 'top.post_id = note.id')
				.select('note.id', 'noteId')
				.addSelect('note.userId', 'authorId')
				.addSelect('top.renoters', 'renoters')
				.addSelect('top.repliers', 'repliers')
				.addSelect('top.reactors', 'reactors')
				.addSelect('top.engagers', 'engagers')
				.addSelect('EXISTS (SELECT 1 FROM "following" f WHERE f."followerId" = :meId AND f."followeeId" = "note"."userId")', 'isFollowingAuthor')
				.addSelect('(SELECT count(*) FROM "following" f WHERE f."followerId" = :meId AND f."followeeId" = ANY(top.engager_ids))::int', 'followedEngagers')
				// Nothing you wrote or already interacted with
				.where('note.userId != :meId')
				.andWhere('NOT (:meId = ANY(top.engager_ids))')
				.setParameters({ meId: me.id });

			this.queryService.andNotBlockingUser(query, ':meId', 'note.userId');
			this.queryService.generateBlockedHostQueryForNote(query);
			this.queryService.generateSuspendedUserQueryForNote(query);
			this.queryService.generateMutedUserQueryForNotes(query, me);
			this.queryService.generateBlockedUserQueryForNotes(query, me);
			this.queryService.generateMutedNoteThreadQuery(query, me);

			const candidates = await query.getRawMany<CandidateRow>();

			const ranked = rankTopPosts(
				candidates.map(candidate => ({
					...candidate,
					createdAt: this.idService.parse(candidate.noteId).date.getTime(),
				})),
				this.timeService.now,
				ps.limit,
			);

			if (ranked.length === 0) {
				return [];
			}

			const notes = await this.notesRepository.findBy({
				id: In(ranked.map(post => post.noteId)),
			});

			const packedNotes = await this.noteEntityService.packMany(notes, me);
			const packedNoteMap = new Map(packedNotes.map(note => [note.id, note]));

			return ranked.flatMap(post => {
				const packedNote = packedNoteMap.get(post.noteId);
				if (!packedNote) return [];

				return [{
					note: packedNote,
					score: post.score,
					scoreExplanation: post.scoreExplanation,
				}];
			});
		});
	}
}
