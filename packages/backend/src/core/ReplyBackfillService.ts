/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { MiMeta, MiNote, NotesRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import { QueryService } from '@/core/QueryService.js';
import { QueueService } from '@/core/QueueService.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { ApNoteService } from '@/core/activitypub/models/ApNoteService.js';
import { CacheService } from '@/core/CacheService.js';
import { TimeService } from '@/global/TimeService.js';
import { getAutoBackfillCooldown, maxAutoBackfillCooldown } from '@/misc/reply-backfill-cooldown.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';

const manualCooldown = 1000 * 60 * 15;

// Bounds how long a crashed worker can make a note look busy.
const inProgressTimeout = 1000 * 60 * 10;

export type ManualBackfillResult =
	| { status: 'queued' | 'running', backfillId: string }
	| { status: 'recentlyChecked' };

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
		private readonly globalEventService: GlobalEventService,
		private readonly apNoteService: ApNoteService,
		private readonly cacheService: CacheService,
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

			const backfillId = await this.claim(note.id);
			if (backfillId == null) return;

			await this.redisClient.set(lastQueuedKey, String(now), 'PX', maxAutoBackfillCooldown);
			await this.queueService.createBackfillRepliesJob(note.id, true, backfillId);
		} catch (err) {
			this.logger.warn(`Failed to request automatic reply backfill for note ${noteId}: ${renderInlineError(err)}`);
		}
	}

	/**
	 * Queues a user-requested backfill. The caller must already have checked that the note is remote, public, and federated with.
	 * If a backfill of the note is already pending or running, returns that one's ID instead, so the caller can follow it.
	 */
	@bindThis
	public async requestManual(noteId: MiNote['id']): Promise<ManualBackfillResult> {
		const backfillId = await this.claim(noteId);
		if (backfillId == null) {
			const running = await this.redisClient.get(this.inProgressKey(noteId));
			// The running backfill may have finished in the meantime.
			return running != null ? { status: 'running', backfillId: running } : { status: 'recentlyChecked' };
		}

		const lastQueuedKey = `replyBackfill:lastManualQueued:${noteId}`;
		const wasSet = await this.redisClient.set(lastQueuedKey, String(this.timeService.now), 'PX', manualCooldown, 'NX');
		if (wasSet == null) {
			await this.release(noteId, backfillId);
			return { status: 'recentlyChecked' };
		}

		await this.queueService.createBackfillRepliesJob(noteId, false, backfillId);
		return { status: 'queued', backfillId };
	}

	/**
	 * Runs a queued backfill and announces its start and outcome on the note's stream, so open threads can show progress.
	 * A failed backfill is not retried: retrying would walk the whole thread again, and viewers have already been told it failed.
	 * @returns Summary for the job queue
	 */
	@bindThis
	public async run(noteId: MiNote['id'], automatic: boolean, backfillId: string): Promise<string> {
		try {
			const note = await this.notesRepository.findOneBy({ id: noteId });
			if (!note) return `Skipping backfill-replies task: note ${noteId} has been deleted`;
			if (note.userHost == null || note.uri == null) return `Skipping backfill-replies task: note ${noteId} is local`;

			const skipReason = await this.getSkipReason(note, note.userHost);
			if (skipReason != null) {
				// Someone may already be waiting on this job, so close it out like a failed fetch.
				await this.globalEventService.publishNoteStream(note.id, 'repliesBackfilled', {
					id: note.id,
					userId: note.userId,
					body: { backfillId, automatic, imported: 0, failed: true },
				});
				return `Skipping backfill-replies task: note ${noteId} ${skipReason}`;
			}

			await this.globalEventService.publishNoteStream(note.id, 'repliesBackfillStarted', {
				id: note.id,
				userId: note.userId,
				body: { backfillId, automatic },
			});

			let imported = 0;
			let failed = true;
			try {
				const limits = automatic ? { maxReplies: 30, maxFetches: 100 } : {};
				imported = await this.apNoteService.backfillReplies(note.uri, limits);
				failed = false;
			} catch (err) {
				throw new UnrecoverableError(`failed to backfill replies of note ${noteId}: ${renderInlineError(err)}`);
			} finally {
				await this.globalEventService.publishNoteStream(note.id, 'repliesBackfilled', {
					id: note.id,
					userId: note.userId,
					body: { backfillId, automatic, imported, failed },
				});
			}
			return `ok: imported ${imported} replies`;
		} finally {
			await this.release(noteId, backfillId);
		}
	}

	private async getSkipReason(note: MiNote, host: string): Promise<string | null> {
		// Remote servers only expose public replies, and only for public notes.
		if (note.visibility !== 'public' && note.visibility !== 'home') return 'is not public';
		// The host may have been blocked after the job was queued.
		if (!this.utilityService.isFederationAllowedHost(host)) return 'is from a host that is not federated with';
		const user = await this.cacheService.findUserById(note.userId);
		if (user.isSuspended) return `has a suspended author ${note.userId}`;
		return null;
	}

	private inProgressKey(noteId: MiNote['id']): string {
		return `replyBackfill:inProgress:${noteId}`;
	}

	/**
	 * Reserves the note for a new backfill, so that at most one runs per note.
	 * @returns ID of the new backfill, or null if one is already pending or running
	 */
	private async claim(noteId: MiNote['id']): Promise<string | null> {
		const backfillId = this.idService.gen();
		const claimed = await this.redisClient.set(this.inProgressKey(noteId), backfillId, 'PX', inProgressTimeout, 'NX');
		return claimed != null ? backfillId : null;
	}

	private async release(noteId: MiNote['id'], backfillId: string): Promise<void> {
		// A backfill that outlived its reservation must not release the next one's.
		if (await this.redisClient.get(this.inProgressKey(noteId)) === backfillId) {
			await this.redisClient.del(this.inProgressKey(noteId));
		}
	}
}
