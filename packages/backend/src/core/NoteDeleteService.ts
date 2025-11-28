/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Brackets, In, IsNull, Not } from 'typeorm';
import { Injectable, Inject } from '@nestjs/common';
import type { MiUser, MiLocalUser, MiRemoteUser } from '@/models/User.js';
import { MiNote, IMentionedRemoteUsers } from '@/models/Note.js';
import type {
	InstancesRepository,
	MiMeta,
	NotesRepository,
	UsersRepository,
} from '@/models/_.js';
import { RelayService } from '@/core/RelayService.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import NotesChart from '@/core/chart/charts/notes.js';
import PerUserNotesChart from '@/core/chart/charts/per-user-notes.js';
import InstanceChart from '@/core/chart/charts/instance.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { ApDeliverManagerService } from '@/core/activitypub/ApDeliverManagerService.js';
import { bindThis } from '@/decorators.js';
import { SearchService } from '@/core/SearchService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { isPureRenote } from '@/misc/is-renote.js';
import { LatestNoteService } from '@/core/LatestNoteService.js';
import { ApLogService } from '@/core/ApLogService.js';
import { TimeService } from '@/global/TimeService.js';
import { trackTask } from '@/misc/promise-tracker.js';
import { CollapsedQueueService } from '@/core/CollapsedQueueService.js';
import { Deduplicator } from '@/misc/deduplicator.js';

@Injectable()
export class NoteDeleteService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.instancesRepository)
		private instancesRepository: InstancesRepository,

		private globalEventService: GlobalEventService,
		private relayService: RelayService,
		private federatedInstanceService: FederatedInstanceService,
		private apRendererService: ApRendererService,
		private apDeliverManagerService: ApDeliverManagerService,
		private searchService: SearchService,
		private moderationLogService: ModerationLogService,
		private notesChart: NotesChart,
		private perUserNotesChart: PerUserNotesChart,
		private instanceChart: InstanceChart,
		private latestNoteService: LatestNoteService,
		private readonly apLogService: ApLogService,
		private readonly timeService: TimeService,
		private readonly collapsedQueueService: CollapsedQueueService,
	) {}

	/**
	 * 投稿を削除します。
	 */
	async delete(user: MiUser, note: MiNote, deleter?: MiUser, immediate = false) {
		if (note.userId !== user.id) {
			throw new Error(`Not deleting note ${note.id} because user ${user.id} is not the expected author ${note.userId}. This is likely a bug; please report this error to Sharkey team.`);
		}

		// This kicks off lots of things that can run in parallel, but we should still wait for completion to ensure consistent state and to avoid task flood when calling in a loop.
		const promises: Promise<unknown>[] = [];

		const deletedAt = this.timeService.date;
		const cascadingNotes = await this.findCascadingNotes(note);
		const allNotes = [note, ...cascadingNotes];

		const noteDeduplicator = new Deduplicator<MiNote>(
			async id => await this.notesRepository.findOneByOrFail({ id }),
			allNotes.map(note => [note.id, note]),
		);

		// Increment updateNoteQueue
		for (const note of allNotes) {
			if (note.replyId) {
				this.collapsedQueueService.updateNoteQueue.enqueue(note.replyId, { repliesCountDelta: -1 });
			} else if (isPureRenote(note)) {
				this.collapsedQueueService.updateNoteQueue.enqueue(note.renoteId, { renoteCountDelta: -1 });
			}
		}

		// Braces preserved to avoid merge conflicts
		{
			// Publish websocket deleted events
			for (const note of allNotes) {
				promises.push(this.globalEventService.publishNoteStream(note.id, 'deleted', {
					deletedAt: deletedAt,
				}));
			}

			// Federate Delete(Note) or Undo(Announce(Note)) activities
			//#region ローカルの投稿なら削除アクティビティを配送
			for (const note of allNotes) {
				if (note.userHost == null && !note.localOnly) {
					const apUser = { id: note.userId, host: null };

					if (isPureRenote(note)) {
						promises.push(noteDeduplicator.fetch(note.renoteId).then(async renote => {
							const content = this.apRendererService.addContext(this.apRendererService.renderUndo(this.apRendererService.renderAnnounce(renote.uri ?? `${this.config.url}/notes/${renote.id}`, note), apUser));
							await this.deliverToConcerned(apUser, note, content);
						}));
					} else {
						const content = this.apRendererService.addContext(this.apRendererService.renderDelete(this.apRendererService.renderTombstone(`${this.config.url}/notes/${note.id}`), apUser));
						promises.push(this.deliverToConcerned(apUser, note, content));
					}
				}
			}
			//#endregion

			// Update charts
			for (const note of allNotes) {
				this.notesChart.update(note, false);
				if (this.meta.enableChartsForRemoteUser || (note.userHost == null)) {
					this.perUserNotesChart.update({ id: note.userId }, note, false);
				}
			}

			// Increment updateUserQueue.
			// Don't mark cascaded user as updated (active)!
			this.collapsedQueueService.updateUserQueue.enqueue(user.id, { updatedAt: this.timeService.date });

			for (const note of allNotes) {
				if (!isPureRenote(note)) {
					this.collapsedQueueService.updateUserQueue.enqueue(note.userId, { notesCountDelta: -1 });
				}
			}

			// Update instance stats and queue
			if (this.meta.enableStatsForFederatedInstances) {
				for (const note of allNotes) {
					if (note.userHost != null) {
						if (!isPureRenote(note)) {
							promises.push(instanceDeduplicator.fetch(note.userHost).then(i => {
								this.collapsedQueueService.updateInstanceQueue.enqueue(i.id, { notesCountDelta: -1 });
							}));
						}
						if (this.meta.enableChartsForFederatedInstances) {
							this.instanceChart.updateNote(note.userHost, note, false);
						}
					}
				}
			}
		}

		// Increment updateChannelQueue
		const userChannelNotes = new Map<string, Map<string, number>>();
		for (const note of allNotes) {
			if (note.channelId != null) {
				// Get or fetch number of notes by this user in the given channel.
				let channelNotes = userChannelNotes.get(note.userId);
				if (channelNotes == null) {
					channelNotes = new Map<string, number>();
					userChannelNotes.set(note.userId, channelNotes);
				}
				let notes = channelNotes.get(note.channelId);
				if (notes == null) {
					// TODO find a way to get rid of this await
					notes = await this.notesRepository.countBy({
						userId: user.id,
						channelId: note.channelId,
					});
					channelNotes.set(note.userId, notes);
				}

				this.collapsedQueueService.updateChannelQueue.enqueue(note.channelId, {
					notesCountDelta: -1,

					// If we're about the delete the user's only note in the channel, then drop them from the count.
					usersCountDelta: notes === 1 ? -1 : undefined,
				});

				// Decrement the note we're going to delete
				if (notes > 0) {
					notes--;
					channelNotes.set(note.userId, notes);
				}
			}
		}

		// Remove from search index
		for (const note of allNotes) {
			promises.push(this.searchService.unindexNote(note));
		}

		// Actually delete the note.
		// Don't put this in the promise array, since it needs to happen before the next section.
		await this.notesRepository.delete({ id: note.id });

		// Update the Latest Note index / following feed *after* note is deleted
		for (const note of allNotes) {
			promises.push(immediate
				? this.latestNoteService.handleDeletedNote(note)
				: this.latestNoteService.handleDeletedNoteDeferred(note));
		}

		// Write mod log
		if (deleter && (user.id !== deleter.id)) {
			promises.push(this.moderationLogService.log(deleter, 'deleteNote', {
				noteId: note.id,
				noteUserId: note.userId,
				noteUserUsername: user.username,
				noteUserHost: user.host,
			}));
		}

		// Delete AP logs
		const deletedUris = allNotes
			.map(n => n.uri)
			.filter((u): u is string => u != null);
		if (deletedUris.length > 0) {
			promises.push(immediate
				? this.apLogService.deleteObjectLogs(deletedUris)
				: this.apLogService.deleteObjectLogsDeferred(deletedUris));
		}

		await trackTask(async () => {
			await Promise.allSettled(promises);

			// This is deferred to make sure we don't race the enqueue() calls
			if (immediate) {
				await this.collapsedQueueService.performAllNow();
			}
		});
	}

	@bindThis
	private async findCascadingNotes(note: MiNote): Promise<MiNote[]> {
		const cascadingNotes = new Map<string, MiNote>();

		/**
		 * Finds all replies, quotes, and renotes of the given list of notes.
		 * These are the notes that will be CASCADE deleted when the origin note is deleted.
		 *
		 * This works by operating in "layers" that radiate out from the origin note like a web.
		 * The process is roughly like this:
		 *   1. Find all immediate replies and renotes of the origin.
		 *   2. Find all immediate replies and renotes of the results from step one.
		 *   3. Repeat until step 2 returns no new results.
		 *   4. Collect all the step 2 results; those are the set of all cascading notes.
		 */
		const cascade = async (layer: string[]): Promise<void> => {
			const refs = await this.notesRepository.find({
				where: [
					{ replyId: In(layer) },
					{ renoteId: In(layer) },
				],
			});

			const nextLayer: string[] = [];

			// Workaround for renote loop bug
			for (const note of refs) {
				if (!cascadingNotes.has(note.id)) {
					cascadingNotes.set(note.id, note);
					nextLayer.push(note.id);
				}
			}

			// Stop when we reach the end of all threads
			if (nextLayer.length < 1) return;

			await cascade(nextLayer);
		};

		// Start with the origin, which should *not* be in the result set!
		await cascade([note.id]);

		return cascadingNotes.values().toArray();
	}

	@bindThis
	private async getMentionedRemoteUsers(note: MiNote) {
		const where = [] as any[];

		// mention / reply / dm
		const uris = (JSON.parse(note.mentionedRemoteUsers) as IMentionedRemoteUsers).map(x => x.uri);
		if (uris.length > 0) {
			where.push(
				{ uri: In(uris) },
			);
		}

		// renote / quote
		if (note.renoteUserId) {
			where.push({
				id: note.renoteUserId,
			});
		}

		if (where.length === 0) return [];

		return await this.usersRepository.find({
			where,
		}) as MiRemoteUser[];
	}

	@bindThis
	private async getRenotedOrRepliedRemoteUsers(note: MiNote) {
		const query = this.notesRepository.createQueryBuilder('note')
			.leftJoinAndSelect('note.user', 'user')
			.where(new Brackets(qb => {
				qb.orWhere('note.renoteId = :renoteId', { renoteId: note.id });
				qb.orWhere('note.replyId = :replyId', { replyId: note.id });
			}))
			.andWhere({ userHost: Not(IsNull()) });
		const notes = await query.getMany() as (MiNote & { user: MiRemoteUser })[];
		const remoteUsers = notes.map(({ user }) => user);
		return remoteUsers;
	}

	@bindThis
	private async deliverToConcerned(user: { id: MiLocalUser['id']; host: null; }, note: MiNote, content: any) {
		await this.apDeliverManagerService.deliverToFollowers(user, content);
		await this.apDeliverManagerService.deliverToUsers(user, content, [
			...await this.getMentionedRemoteUsers(note),
			...await this.getRenotedOrRepliedRemoteUsers(note),
		]);
		await this.relayService.deliverToRelays(user, content);
	}
}
