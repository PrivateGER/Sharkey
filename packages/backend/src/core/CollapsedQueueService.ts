/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { bindThis } from '@/decorators.js';
import { callAllAsync } from '@/misc/call-all.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import type { MiAntenna, FollowingsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { CacheManagementService, type ManagedCollapsedQueue } from '@/global/CacheManagementService.js';
import { AntennaService } from '@/core/AntennaService.js';
import { CacheService } from '@/core/CacheService.js';
import type { DataSource } from 'typeorm';

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
	lastUsedAt?: Date;
};

export type UpdateAntennaJob = {
	isActive?: boolean,
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
		@Inject(DI.followingsRepository)
		private readonly followingsRepository: FollowingsRepository,

		@Inject(DI.db)
		private readonly db: DataSource,

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
					shouldUnsuspend: or(oldJob.shouldUnsuspend, newJob.shouldUnsuspend),
					shouldSuspendGone: or(oldJob.shouldSuspendGone, newJob.shouldSuspendGone),
					shouldSuspendNotResponding: or(oldJob.shouldSuspendNotResponding, newJob.shouldSuspendNotResponding),
					notesCountDelta: sum(oldJob.notesCountDelta, newJob.notesCountDelta),
					usersCountDelta: sum(oldJob.usersCountDelta, newJob.usersCountDelta),
					followingCountDelta: sum(oldJob.followingCountDelta, newJob.followingCountDelta),
					followersCountDelta: sum(oldJob.followersCountDelta, newJob.followersCountDelta),
				}),
				perform: async (host, job) => {
					// Avoid empty UPDATE statements
					if (!(job.latestRequestReceivedAt ||
						job.notRespondingSince !== undefined || // This one allows null
						job.shouldSuspendNotResponding ||
						job.shouldSuspendGone ||
						job.shouldUnsuspend ||
						job.notesCountDelta ||
						job.usersCountDelta ||
						job.followingCountDelta ||
						job.followersCountDelta
					)) {
						// TODO return a "skipped" sentinel
						return;
					}

					const sb = new SqlBuilder();
					sb.add('UPDATE "instance"');
					sb.add('SET');

					const sets = sb.list();

					if (job.latestRequestReceivedAt) {
						sets.add('"latestRequestReceivedAt" = GREATEST("latestRequestReceivedAt", $?)', job.latestRequestReceivedAt);
					}

					// null (responding) > Date (not responding)
					if (job.notRespondingSince != null) {
						sets.add(`
							"notRespondingSince" =
								CASE
									WHEN "notRespondingSince" IS NULL THEN NULL
									ELSE LEAST("notRespondingSince", $?)
								END
						`, job.notRespondingSince);
					} else if (job.notRespondingSince === null) {
						sets.add('"notRespondingSince" = NULL');
					}

					// isNotResponding derives from latestRequestReceivedAt and notRespondingSince
					if (job.latestRequestReceivedAt || job.notRespondingSince !== undefined) {
						if (job.latestRequestReceivedAt || job.notRespondingSince === null) {
							sets.add('"isNotResponding" = false');
						} else {
							sets.add('"isNotResponding" = true');
						}
					}

					// manual > gone > none > auto
					if (job.shouldSuspendGone) {
						sets.add(`
							"suspensionState" =
								CASE
									WHEN "suspensionState" = 'manuallySuspended' THEN 'manuallySuspended'
									ELSE 'goneSuspended'
								END
						`);
					} else if (job.shouldUnsuspend) {
						sets.add(`
							"suspensionState" =
								CASE
									WHEN "suspensionState" = 'manuallySuspended' THEN 'manuallySuspended'
									WHEN "suspensionState" = 'goneSuspended' THEN 'goneSuspended'
									ELSE 'none'
								END
						`);
					} else if (job.shouldSuspendNotResponding) {
						sets.add(`
							"suspensionState" =
								CASE
										WHEN "suspensionState" = 'manuallySuspended' THEN 'manuallySuspended'
										WHEN "suspensionState" = 'goneSuspended' THEN 'goneSuspended'
										WHEN "notRespondingSince" IS NULL THEN 'none'
										ELSE 'autoSuspendedForNotResponding'
								END
						`);
					}

					if (job.notesCountDelta) {
						sets.add('"notesCount" = "notesCount" + $?', job.notesCountDelta);
					}

					if (job.usersCountDelta) {
						sets.add('"usersCount" = "usersCount" + $?', job.usersCountDelta);
					}

					if (job.followersCountDelta) {
						sets.add('"followersCount" = "followersCount" + $?', job.followersCountDelta);
					}

					if (job.followingCountDelta) {
						sets.add('"followingCount" = "followingCount" + $?', job.followingCountDelta);
					}

					sb.add('WHERE "host" = $?', host);
					const query = sb.build();

					// Manually update and sync caches
					await this.db.query(query.sql, query.parameters);
					await this.federatedInstanceService.refresh('host');
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
					notesCountDelta: sum(oldJob.notesCountDelta, newJob.notesCountDelta),
					followingCountDelta: sum(oldJob.followingCountDelta, newJob.followingCountDelta),
					followersCountDelta: sum(oldJob.followersCountDelta, newJob.followersCountDelta),
				}),
				perform:
					async (userId, job) => {
						// Avoid empty UPDATE statements
						if (!(job.updatedAt || job.lastActiveDate || job.notesCountDelta || job.followingCountDelta || job.followersCountDelta)) {
							return;
						}

						const sb = new SqlBuilder();
						sb.add('UPDATE "user"');
						sb.add('SET');

						const sets = sb.list();

						if (job.updatedAt) {
							sets.add('"updatedAt" = GREATEST("updatedAt", $?)', job.updatedAt);
						}

						const lastActiveDate = job.lastActiveDate ?? job.updatedAt;
						if (lastActiveDate) {
							sets.add('"lastActiveDate" = GREATEST("lastActiveDate", $?)', lastActiveDate);
						}

						const isWakingUp = lastActiveDate && (await this.cacheService.findUserById(userId)).isHibernated;
						if (isWakingUp) {
							sets.add('"isHibernated" = false');
						}

						if (job.notesCountDelta) {
							sets.add('"notesCount" = "notesCount" + $?', job.notesCountDelta);
						}

						if (job.followersCountDelta) {
							sets.add('"followersCount" = "followersCount" + $?', job.followersCountDelta);
						}

						if (job.followingCountDelta) {
							sets.add('"followingCount" = "followingCount" + $?', job.followingCountDelta);
						}

						sb.add('WHERE "id" = $?', userId);
						const query = sb.build();

						// Manually update and sync caches
						await this.db.query(query.sql, query.parameters);
						await this.internalEventService.emit('userUpdated', { id: userId });

						if (isWakingUp) {
							// Cache event is covered by user sync above
							await this.followingsRepository.update({ followerId: userId }, { isFollowerHibernated: false });
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
					repliesCountDelta: sum(oldJob.repliesCountDelta, newJob.repliesCountDelta),
					renoteCountDelta: sum(oldJob.renoteCountDelta, newJob.renoteCountDelta),
					clippedCountDelta: sum(oldJob.clippedCountDelta, newJob.clippedCountDelta),
				}),
				perform: async (noteId, job) => {
					// Avoid empty UPDATE statements
					if (!(job.repliesCountDelta || job.renoteCountDelta || job.clippedCountDelta)) {
						return;
					}

					const sb = new SqlBuilder();
					sb.add('UPDATE "note"');
					sb.add('SET');

					const sets = sb.list();

					if (job.repliesCountDelta) {
						sets.add('"repliesCount" = "repliesCount" + $?', job.repliesCountDelta);
					}

					if (job.renoteCountDelta) {
						sets.add('"renoteCount" = "renoteCount" + $?', job.renoteCountDelta);
					}

					if (job.clippedCountDelta) {
						sets.add('"clippedCount" = "clippedCount" + $?', job.clippedCountDelta);
					}

					sb.add('WHERE "id" = $?', noteId);
					const query = sb.build();

					await this.db.query(query.sql, query.parameters);
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
					await this.db.sql`
						UPDATE "access_token"
						SET "lastUsedAt" = GREATEST("lastUsedAt", ${job.lastUsedAt})
						WHERE "id" = ${id}
					`;
				},
			},
		);

		this.updateAntennaQueue = this.cacheManagementService.createCollapsedQueue(
			'updateAntenna',
			{
				timeout: fiveMinuteInterval,
				limiter: 4,
				collapse: (oldJob, newJob) => ({
					isActive: or(oldJob.isActive, newJob.isActive),
					lastUsedAt: maxDate(oldJob.lastUsedAt, newJob.lastUsedAt),
				}),
				perform: async (antennaId, job) => {
					// Avoid empty UPDATE statements
					if (!(job.isActive || job.lastUsedAt)) {
						return;
					}

					const sb = new SqlBuilder();
					sb.add('UPDATE "antenna"');
					sb.add('SET');

					const sets = sb.list();

					if (job.isActive) {
						sets.add('"isActive" = "isActive" OR $?', job.isActive);
					}

					if (job.lastUsedAt) {
						sets.add('"lastUsedAt" = GREATEST("lastUsedAt", $?)', job.lastUsedAt);
					}

					sb.add('WHERE "id" = $?', antennaId);
					const query = sb.build();

					// Manually update and sync caches
					await this.db.query(query.sql, query.parameters);
					await this.antennaService.refreshAntenna(antennaId);
				},
			},
		);

		this.internalEventService.on('userChangeDeletedState', this.onUserDeleted);
		this.internalEventService.on('antennaDeleted', this.onAntennaDeleted);
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
	}

	@bindThis
	public async performAllNow(): Promise<void> {
		await callAllAsync([
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

// TODO promote these to utilities

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

function sum(first: number, second: number): number;
function sum(first: number | null, second: number | null): number | null;
function sum(first: number | undefined, second: number | undefined): number | undefined;
function sum(first: number | null | undefined, second: number | null | undefined): number | null | undefined;

function sum(first: number | null | undefined, second: number | null | undefined): number | null | undefined {
	// If we only have one entry, then the other is the result byDefault
	if (first === undefined) {
		return second;
	}
	if (second === undefined) {
		return first;
	}

	// Null is considered infinitely high, and is therefore higher than any other number.
	if (first === null || second === null) {
		return null;
	}

	// If both numbers are defined, then add directly.
	return first + second;
}

function or(first: boolean, second: boolean): boolean;
function or(first: boolean | null, second: boolean | null): boolean | null;
function or(first: boolean | undefined, second: boolean | undefined): boolean | undefined;
function or(first: boolean | null | undefined, second: boolean | null | undefined): boolean | null | undefined;

function or(first: boolean | null | undefined, second: boolean | null | undefined): boolean | null | undefined {
	// If we only have one entry, then the other is the result byDefault
	if (first === undefined) {
		return second;
	}
	if (second === undefined) {
		return first;
	}

	// Null is considered infinitely true, and is therefore truer than any other boolean.
	if (first === null || second === null) {
		return null;
	}

	// If both booleans are defined, then compare directly.
	return first || second;
}

class SqlBuilder {
	private readonly lines: string[] = [];
	private readonly parameters: unknown[] = [];
	private nextVarId = 1;

	constructor() {}

	private getNextReplacement(): string {
		const replacement = '$' + this.nextVarId;
		this.nextVarId++;
		return replacement;
	}

	// https://typeorm.io/docs/data-source/data-source-api/
	public add(sql: string, ...params: unknown[]): void {
		// Populate the variable number for all parameters
		const namedParams = new Map<string, string>();
		sql = sql.replaceAll(/\$\?(\d+\b)?/g, match => {
			// Named variable - store & reuse the mapping
			if (match[1]) {
				let name = namedParams.get(match[1]);
				if (name == null) {
					name = this.getNextReplacement();
					namedParams.set(match[1], name);
				}
				return name;
			}

			// Unnamed variable
			return this.getNextReplacement();
		});

		this.lines.push(sql);

		this.parameters.push(...params);
	}

	public list(): SqlListBuilder {
		return new SqlListBuilder(this, '    ');
	}

	public build() {
		return {
			sql: this.lines.join('\n'),
			parameters: this.parameters,
		};
	}
}

class SqlListBuilder {
	private isFirst = true;

	constructor(
		private readonly sqlBuilder: SqlBuilder,
		private readonly indent: string,
	) {}

	add(sql: string, ...params: unknown[]): void {
		if (this.isFirst) {
			this.isFirst = false;
		} else {
			sql += ', ';
		}

		sql += this.indent;
		this.sqlBuilder.add(sql, ...params);
	}

	public list(): SqlListBuilder {
		return new SqlListBuilder(this.sqlBuilder, this.indent + '    ');
	}
}
