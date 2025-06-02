import { Inject, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import type { NotesRepository, MiMeta } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import ActiveUsersChart from '@/core/chart/charts/active-users.js';
import { DI } from '@/di-symbols.js';
import { RoleService } from '@/core/RoleService.js';
import { CacheService } from '@/core/CacheService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},

	errors: {
		btlDisabled: {
			message: 'Bubble timeline has been disabled.',
			code: 'BTL_DISABLED',
			id: '0332fc13-6ab2-4427-ae80-a9fadffd1a6c',
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
		withFiles: { type: 'boolean', default: false },
		withBots: { type: 'boolean', default: true },
		withRenotes: { type: 'boolean', default: true },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
		private roleService: RoleService,
		private activeUsersChart: ActiveUsersChart,
		private cacheService: CacheService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const policies = await this.roleService.getUserPolicies(me ? me.id : null);
			if (!policies.btlAvailable) {
				throw new ApiError(meta.errors.btlDisabled);
			}

			const followings = me ? await this.cacheService.userFollowingsCache.fetch(me.id) : undefined;

			//#region Construct query
			const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'),
				ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
				.andWhere('note.visibility = \'public\'')
				.andWhere('note.channelId IS NULL')
				.andWhere('note.userHost IS NOT NULL')
				.andWhere('userInstance.isBubbled = true') // This comes from generateBlockedHostQueryForNote below
				.innerJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser');

			await this.queryService.generateVisibilityQuery(query, me);
			this.queryService.generateBlockedHostQueryForNote(query);
			if (me) this.queryService.generateMutedUserQueryForNotes(query, me);
			if (me) this.queryService.generateBlockedUserQueryForNotes(query, me);
			if (me) this.queryService.generateMutedUserRenotesQueryForNotes(query, me);
			if (!me) query.andWhere('user.requireSigninToViewContents = false');

			if (ps.withFiles) {
				query.andWhere('note.fileIds != \'{}\'');
			}

			if (!ps.withBots) query.andWhere('user.isBot = FALSE');

			if (!ps.withRenotes) {
				query.andWhere(new Brackets(qb => qb
					.orWhere('note.renoteId IS NULL')
					.orWhere('note.text IS NOT NULL')
					.orWhere('note.cw IS NOT NULL')
					.orWhere('note.replyId IS NOT NULL')
					.orWhere('note.hasPoll = false')
					.orWhere('note.fileIds != \'{}\'')));
			}
			//#endregion

			let timeline = await query.limit(ps.limit).getMany();

			timeline = timeline.filter(note => {
				if (note.user?.isSilenced) {
					if (!me) return false;
					if (!followings) return false;
					if (note.userId !== me.id) {
						return followings[note.userId];
					}
				}
				return true;
			});

			process.nextTick(() => {
				if (me) {
					this.activeUsersChart.read(me);
				}
			});

			return await this.noteEntityService.packMany(timeline, me);
		});
	}
}
