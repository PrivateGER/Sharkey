/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { MiMeta, NotesRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import { QueryService } from '@/core/QueryService.js';
import { QueueService } from '@/core/QueueService.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { TimeService } from '@/global/TimeService.js';
import { getAutoBackfillCooldown, maxAutoBackfillCooldown } from '@/misc/reply-backfill-cooldown.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { UtilityService } from '@/core/UtilityService.js';

@Injectable()
export class ReplyBackfillService {
	private readonly logger: Logger;

	constructor(
		@Inject(DI.meta)
		private readonly meta: MiMeta,

		@Inject(DI.redis)
		private readonly redisClient: Redis.Redis,

		@Inject(DI.notesRepository)
		private readonly notesRepository: NotesRepository,

		private readonly queryService: QueryService,
		private readonly queueService: QueueService,
		private readonly utilityService: UtilityService,
		private readonly idService: IdService,
		private readonly timeService: TimeService,
		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('reply-backfill');
	}

	/**
	 * Queues an automatic backfill of a remote thread that a user is viewing, if the server allows it and the thread is due.
	 * Never throws: a failure here must not affect loading the thread.
	 */
	@bindThis
	public async requestAutomatic(noteId: string, me: MiLocalUser): Promise<void> {
		try {
			if (!this.meta.enableAutoReplyBackfill) return;

			const query = this.notesRepository.createQueryBuilder('note')
				.where('note.id = :noteId', { noteId })
				.innerJoin('note.user', 'user');
			this.queryService.generateVisibilityQuery(query, me);
			this.queryService.generateBlockedUserQueryForNotes(query, me);
			const note = await query.getOne();

			if (note == null || note.userHost == null || note.uri == null) return;
			if (note.visibility !== 'public' && note.visibility !== 'home') return;
			if (!this.utilityService.isFederationAllowedHost(note.userHost)) return;

			// Remote note IDs encode their published time, so the newest ID in the thread marks its last known activity.
			const newestInThread = await this.notesRepository.findOne({
				where: { threadId: note.threadId ?? note.id },
				order: { id: 'DESC' },
				select: { id: true },
			});
			const lastActivity = Math.max(
				this.idService.parse(note.id).date.getTime(),
				newestInThread ? this.idService.parse(newestInThread.id).date.getTime() : 0,
			);

			const now = this.timeService.now;
			const cooldown = getAutoBackfillCooldown(now - lastActivity);
			if (cooldown == null) return;

			// The cooldown is recomputed on every view, so a quiet thread that gains a new reply becomes due again right away.
			const lastQueuedKey = `replyBackfill:lastAutoQueued:${note.id}`;
			const lastQueued = await this.redisClient.get(lastQueuedKey);
			if (lastQueued != null && now - Number(lastQueued) < cooldown) return;

			await this.redisClient.set(lastQueuedKey, String(now), 'PX', maxAutoBackfillCooldown);
			await this.queueService.createAutoBackfillRepliesJob(note.id);
		} catch (err) {
			this.logger.warn(`Failed to request automatic reply backfill for note ${noteId}: ${renderInlineError(err)}`);
		}
	}
}
