/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { NotesRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { DI } from '@/di-symbols.js';
import { DataSource, In } from 'typeorm';

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

// Define the type for the top post from the database
interface TopPost {
	post_id: string;
	total_score: number;
	score_explanation: Record<string, any>;
}

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.db)
		private db: DataSource,

		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// Only authenticated local users can see their personalized top posts
			if (!me || me.host !== null) {
				throw new Error('Access denied: Only local users can view top posts');
			}

			// Get top posts from the materialized view.
			// I CANNOT be arsed to do this with TypeORM.
			const topPosts = await this.db.query<TopPost[]>(
				`SELECT post_id, total_score, score_explanation
				FROM top_interesting_posts_for_local_users
				WHERE user_id = $1
				ORDER BY rank ASC
				LIMIT $2`,
				[me.id, ps.limit]
			);

			// If no top posts found, return empty array
			if (topPosts.length === 0) {
				return [];
			}

			const noteIds = topPosts.map((post: TopPost) => post.post_id);

			const notes = await this.notesRepository.findBy({
				id: In(noteIds),
			});

			const packedNotes = await this.noteEntityService.packMany(notes, me);
			const packedNoteMap = new Map();
			for (const note of packedNotes) {
				packedNoteMap.set(note.id, note);
			}

			return topPosts
				.map((post: TopPost) => {
					const packedNote = packedNoteMap.get(post.post_id);
					if (!packedNote) return undefined;

					return {
						note: packedNote,
						score: post.total_score,
						scoreExplanation: post.score_explanation,
					};
				})
				.filter((post): post is { note: any; score: number; scoreExplanation: Record<string, any> } =>
					post !== undefined
				);
		});
	}
}
