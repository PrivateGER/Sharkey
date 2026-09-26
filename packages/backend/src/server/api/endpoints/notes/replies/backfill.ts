/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { ReplyBackfillService } from '@/core/ReplyBackfillService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['notes', 'federation'],

	description: 'Fetches the replies of a remote note from its origin server in the background. The note\'s stream announces when the fetch starts and finishes, and each newly imported reply.',

	requireCredential: true,

	kind: 'read:federation',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			status: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['queued', 'running', 'recentlyChecked'],
			},
			backfillId: {
				type: 'string',
				optional: true, nullable: false,
				description: 'Identifies the queued or running fetch in the note stream\'s repliesBackfillStarted and repliesBackfilled events.',
			},
		},
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'ba1b7931-f97e-4d50-bcfe-0cc57e5a5331',
		},

		noteIsLocal: {
			message: 'The note is local, so all of its replies are already known.',
			code: 'NOTE_IS_LOCAL',
			id: 'f02f465e-1cb8-4d10-9815-e8f965f40f4c',
		},

		noteIsNotPublic: {
			message: 'Replies can only be fetched for public or home notes.',
			code: 'NOTE_IS_NOT_PUBLIC',
			id: 'fc41549d-d7ad-47db-a58a-9c53e9ce3eaa',
		},

		hostNotFederated: {
			message: 'This server does not federate with the note\'s origin server.',
			code: 'HOST_NOT_FEDERATED',
			id: 'e7e501b1-0d98-4270-90bd-7fd26b1afe62',
		},
	},

	// 10 calls per minute
	limit: {
		duration: 1000 * 60,
		max: 10,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private readonly notesRepository: NotesRepository,

		private readonly queryService: QueryService,
		private readonly replyBackfillService: ReplyBackfillService,
		private readonly utilityService: UtilityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.notesRepository.createQueryBuilder('note')
				.where('note.id = :noteId', { noteId: ps.noteId })
				.innerJoin('note.user', 'user');

			this.queryService.generateVisibilityQuery(query, me);
			this.queryService.generateBlockedUserQueryForNotes(query, me);

			const note = await query.getOne();
			if (note == null) {
				throw new ApiError(meta.errors.noSuchNote);
			}

			if (note.userHost == null || note.uri == null) {
				throw new ApiError(meta.errors.noteIsLocal);
			}

			if (note.visibility !== 'public' && note.visibility !== 'home') {
				throw new ApiError(meta.errors.noteIsNotPublic);
			}

			if (!this.utilityService.isFederationAllowedHost(note.userHost)) {
				throw new ApiError(meta.errors.hostNotFederated);
			}

			return await this.replyBackfillService.requestManual(note.id);
		});
	}
}
