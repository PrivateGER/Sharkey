/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { bindThis } from '@/decorators.js';
import { callAllAsync } from '@/misc/call-all.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import type { UsersRepository, NotesRepository, AccessTokensRepository, MiAntenna, FollowingsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { CacheManagementService, type ManagedCollapsedQueue } from '@/global/CacheManagementService.js';
import { AntennaService } from '@/core/AntennaService.js';
import { CacheService } from '@/core/CacheService.js';

export type UpdateInstanceJob = {
	latestRequestReceivedAt?: Date,
	notRespondingSince?: Date | null,
	shouldUnsuspend?: boolean,
	shouldSuspendGone?: boolean,
	shouldSuspendNotResponding?: boolean,
	notesCountDelta?: number,
	usersCountDelta?: number,
	followingCountDelta?: number,
	followersCountDelta?: number,
};

export type UpdateUserJob = {
	updatedAt?: Date,
	lastActiveDate?: Date,
	notesCountDelta?: number,
	followingCountDelta?: number,
	followersCountDelta?: number,
};

export type UpdateNoteJob = {
	repliesCountDelta?: number;
	renoteCountDelta?: number;
	clippedCountDelta?: number;
};

export type UpdateAccessTokenJob = {
	lastUsedAt: Date;
};

export type UpdateAntennaJob = {
	isActive: boolean,
	lastUsedAt?: Date,
};

const fiveMinuteInterval = 60 * 1000 * 5;
const oneMinuteInterval = 60 * 1000;

@Injectable()
export class CollapsedQueueService implements OnApplicationShutdown {
	// Moved from InboxProcessorService
	public readonly updateInstanceQueue: ManagedCollapsedQueue<UpdateInstanceJob>;

	// Moved from NoteCreateService, NoteEditService, and NoteDeleteService
	public readonly updateUserQueue: ManagedCollapsedQueue<UpdateUserJob>;

	public readonly updateNoteQueue: ManagedCollapsedQueue<UpdateNoteJob>;
	public readonly updateAccessTokenQueue: ManagedCollapsedQueue<UpdateAccessTokenJob>;
	public readonly updateAntennaQueue: ManagedCollapsedQueue<UpdateAntennaJob>;

	constructor(
		@Inject(DI.usersRepository)
		private readonly usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private readonly notesRepository: NotesRepository,

		@Inject(DI.accessTokensRepository)
		private readonly accessTokensRepository: AccessTokensRepository,

		@Inject(DI.followingsRepository)
		private readonly followingsRepository: FollowingsRepository,

		private readonly federatedInstanceService: FederatedInstanceService,
		private readonly internalEventService: InternalEventService,
		private readonly antennaService: AntennaService,
		private readonly cacheService: CacheService,
		private readonly cacheManagementService: CacheManagementService,
	) {
		// TODO make sure all caches are updated

		this.updateInstanceQueue = this.cacheManagementService.createCollapsedQueue(
			'updateInstance',
			{
				timeout: fiveMinuteInterval,
				limiter: 2, // Low concurrency, this table is slow for some reason
				collapse: (oldJob, newJob) => ({
					latestRequestReceivedAt: maxDate(oldJob.latestRequestReceivedAt, newJob.latestRequestReceivedAt),
					notRespondingSince: minDate(oldJob.notRespondingSince, newJob.notRespondingSince),
					shouldUnsuspend: oldJob.shouldUnsuspend || newJob.shouldUnsuspend,
					shouldSuspendGone: oldJob.shouldSuspendGone || newJob.shouldSuspendGone,
					shouldSuspendNotResponding: oldJob.shouldSuspendNotResponding || newJob.shouldSuspendNotResponding,
					notesCountDelta: (oldJob.notesCountDelta ?? 0) + (newJob.notesCountDelta ?? 0),
					usersCountDelta: (oldJob.usersCountDelta ?? 0) + (newJob.usersCountDelta ?? 0),
					followingCountDelta: (oldJob.followingCountDelta ?? 0) + (newJob.followingCountDelta ?? 0),
					followersCountDelta: (oldJob.followersCountDelta ?? 0) + (newJob.followersCountDelta ?? 0),
				}),
				perform: async (id, job) => {
					// Have to check this because all properties are optional
					if (
						job.latestRequestReceivedAt ||
						job.notRespondingSince !== undefined ||
						job.shouldSuspendNotResponding ||
						job.shouldSuspendGone ||
						job.shouldUnsuspend ||
						job.notesCountDelta ||
						job.usersCountDelta ||
						job.followingCountDelta ||
						job.followersCountDelta
					) {
						await this.federatedInstanceService.update(id, {
							// Direct update if defined
							latestRequestReceivedAt: job.latestRequestReceivedAt,

							// null (responding) > Date (not responding)
							notRespondingSince: job.latestRequestReceivedAt
								? null
								: job.notRespondingSince,

							// false (responding) > true (not responding)
							isNotResponding: job.latestRequestReceivedAt
								? false
								: job.notRespondingSince
									? true
									: undefined,

							// gone > none > auto
							suspensionState: job.shouldSuspendGone
								? 'goneSuspended'
								: job.shouldUnsuspend
									? 'none'
									: job.shouldSuspendNotResponding
										? 'autoSuspendedForNotResponding'
										: undefined,

							// Increment if defined
							notesCount: job.notesCountDelta ? () => `"notesCount" + ${job.notesCountDelta}` : undefined,
							usersCount: job.usersCountDelta ? () => `"usersCount" + ${job.usersCountDelta}` : undefined,
							followingCount: job.followingCountDelta ? () => `"followingCount" + ${job.followingCountDelta}` : undefined,
							followersCount: job.followersCountDelta ? () => `"followersCount" + ${job.followersCountDelta}` : undefined,
						});
					}
				},
			},
		);

		this.updateUserQueue = this.cacheManagementService.createCollapsedQueue(
			'updateUser',
			{
				timeout: oneMinuteInterval,
				limiter: 4, // High concurrency - this queue gets a lot of activity
				collapse: (oldJob, newJob) => ({
					updatedAt: maxDate(oldJob.updatedAt, newJob.updatedAt),
					lastActiveDate: maxDate(oldJob.lastActiveDate, newJob.lastActiveDate),
					notesCountDelta: (oldJob.notesCountDelta ?? 0) + (newJob.notesCountDelta ?? 0),
					followingCountDelta: (oldJob.followingCountDelta ?? 0) + (newJob.followingCountDelta ?? 0),
					followersCountDelta: (oldJob.followersCountDelta ?? 0) + (newJob.followersCountDelta ?? 0),
				}),
				perform:
					async (id, job) => {
						// Have to check this because all properties are optional
						if (job.updatedAt || job.lastActiveDate || job.notesCountDelta || job.followingCountDelta || job.followersCountDelta) {
							// Updating the user should implicitly mark them as active
							const lastActiveDate = job.lastActiveDate ?? job.updatedAt;
							const isWakingUp = lastActiveDate && (await this.cacheService.findUserById(id)).isHibernated;

							// Update user before the hibernation cache, because the latter may refresh from DB
							await this.usersRepository.update({ id }, {
								updatedAt: job.updatedAt,
								lastActiveDate,
								isHibernated: isWakingUp ? false : undefined,
								notesCount: job.notesCountDelta ? () => `"notesCount" + ${job.notesCountDelta}` : undefined,
								followingCount: job.followingCountDelta ? () => `"followingCount" + ${job.followingCountDelta}` : undefined,
								followersCount: job.followersCountDelta ? () => `"followersCount" + ${job.followersCountDelta}` : undefined,
							});
							await this.internalEventService.emit('userUpdated', { id });

							// Wake up hibernated users
							if (isWakingUp) {
								await this.followingsRepository.update({ followerId: id }, { isFollowerHibernated: false });
								await this.cacheService.hibernatedUserCache.set(id, false);
							}
						}
					},
			},
		);

		this.updateNoteQueue = this.cacheManagementService.createCollapsedQueue(
			'updateNote',
			{
				timeout: oneMinuteInterval,
				limiter: 4, // High concurrency - this queue gets a lot of activity
				collapse: (oldJob, newJob) => ({
					repliesCountDelta: (oldJob.repliesCountDelta ?? 0) + (newJob.repliesCountDelta ?? 0),
					renoteCountDelta: (oldJob.renoteCountDelta ?? 0) + (newJob.renoteCountDelta ?? 0),
					clippedCountDelta: (oldJob.clippedCountDelta ?? 0) + (newJob.clippedCountDelta ?? 0),
				}),
				perform: async (id, job) => {
					// Have to check this because all properties are optional
					if (job.repliesCountDelta || job.renoteCountDelta || job.clippedCountDelta) {
						await this.notesRepository.update({ id }, {
							repliesCount: job.repliesCountDelta ? () => `"repliesCount" + ${job.repliesCountDelta}` : undefined,
							renoteCount: job.renoteCountDelta ? () => `"renoteCount" + ${job.renoteCountDelta}` : undefined,
							clippedCount: job.clippedCountDelta ? () => `"clippedCount" + ${job.clippedCountDelta}` : undefined,
						});
					}
				},
			},
		);

		this.updateAccessTokenQueue = this.cacheManagementService.createCollapsedQueue(
			'updateAccessToken',
			{
				timeout: fiveMinuteInterval,
				limiter: 2,
				collapse: (oldJob, newJob) => ({
					lastUsedAt: maxDate(oldJob.lastUsedAt, newJob.lastUsedAt),
				}),
				perform: async (id, job) => {
					await this.accessTokensRepository.update({ id }, {
						lastUsedAt: job.lastUsedAt,
					});
				},
			},
		);

		this.updateAntennaQueue = this.cacheManagementService.createCollapsedQueue(
			'updateAntenna',
			{
				timeout: fiveMinuteInterval,
				limiter: 4,
				collapse: (oldJob, newJob) => ({
					isActive: oldJob.isActive || newJob.isActive,
					lastUsedAt: maxDate(oldJob.lastUsedAt, newJob.lastUsedAt),
				}),
				perform: async (id, job) => await this.antennaService.updateAntenna(id, {
					isActive: job.isActive,
					lastUsedAt: job.lastUsedAt,
				}),
			},
		);

		// TODO check for more of these
		this.internalEventService.on('userChangeDeletedState', this.onUserDeleted);
		this.internalEventService.on('antennaDeleted', this.onAntennaDeleted);
		this.internalEventService.on('antennaUpdated', this.onAntennaDeleted);
	}

	@bindThis
	private onUserDeleted(data: { id: string, isDeleted: boolean }) {
		if (data.isDeleted) {
			this.updateUserQueue.delete(data.id);
		}
	}

	@bindThis
	private onAntennaDeleted(data: MiAntenna) {
		this.updateAntennaQueue.delete(data.id);
	}

	@bindThis
	public dispose(): void {
		this.internalEventService.off('userChangeDeletedState', this.onUserDeleted);
		this.internalEventService.off('antennaDeleted', this.onAntennaDeleted);
		this.internalEventService.off('antennaUpdated', this.onAntennaDeleted);
	}

	@bindThis
	public async performAllNow(): Promise<void> {
		await callAllAsync([
			async () => await this.updateInstanceQueue.performAllNow(),
			async () => await this.updateInstanceQueue.performAllNow(),
			async () => await this.updateUserQueue.performAllNow(),
			async () => await this.updateNoteQueue.performAllNow(),
			async () => await this.updateAccessTokenQueue.performAllNow(),
			async () => await this.updateAntennaQueue.performAllNow(),
		]);
	}

	@bindThis
	public onApplicationShutdown(): void {
		this.dispose();
	}
}

function maxDate(first: Date, second: Date): Date;
function maxDate(first: Date | null, second: Date | null): Date | null;
function maxDate(first: Date | undefined, second: Date | undefined): Date | undefined;
function maxDate(first: Date | null | undefined, second: Date | null | undefined): Date | null | undefined;

function maxDate(first: Date | null | undefined, second: Date | null | undefined): Date | null | undefined {
	// If we only have one entry, then the other is the max by default.
	if (first === undefined) {
		return second;
	}
	if (second === undefined) {
		return first;
	}

	// Null is considered infinitely in the future, and is therefore newer than any date.
	if (first === null || second === null) {
		return null;
	}

	// If both dates have values, then compare by raw time
	return first.getTime() > second.getTime()
		? first
		: second;
}

function minDate(first: Date, second: Date): Date;
function minDate(first: Date | null, second: Date | null): Date | null;
function minDate(first: Date | undefined, second: Date | undefined): Date | undefined;
function minDate(first: Date | null | undefined, second: Date | null | undefined): Date | null | undefined;

function minDate(first: Date | null | undefined, second: Date | null | undefined): Date | null | undefined {
	// If we only have one entry, then the other is the min by default.
	if (first === undefined) {
		return second;
	}
	if (second === undefined) {
		return first;
	}

	// Null is considered infinitely in the future, and is therefore newer than any date.
	if (first === null) {
		return second;
	}
	if (second === null) {
		return first;
	}

	// If both dates have values, then compare by raw time
	return first.getTime() < second.getTime()
		? first
		: second;
}

