/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { NotesRepository, UsersRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import { NotificationService } from '@/core/NotificationService.js';
import { RoleService } from '@/core/RoleService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { CacheService } from '@/core/CacheService.js';
import { isSystemAccount } from '@/misc/is-system-account.js';
import { bindThis } from '@/decorators.js';

const batchSize = 100;

// Outlives any realistic retry backoff, so a retried job resumes instead of notifying everyone twice.
const progressTtlSeconds = 60 * 60 * 24 * 7;

@Injectable()
export class AnnouncementNoteService {
	constructor(
		@Inject(DI.redis)
		private readonly redisClient: Redis.Redis,

		@Inject(DI.notesRepository)
		private readonly notesRepository: NotesRepository,

		@Inject(DI.usersRepository)
		private readonly usersRepository: UsersRepository,

		private readonly notificationService: NotificationService,
		private readonly roleService: RoleService,
		private readonly utilityService: UtilityService,
		private readonly cacheService: CacheService,
	) {
	}

	/**
	 * Sends an announcementNote notification for the note to every active local user except its author.
	 */
	@bindThis
	public async notifyLocalUsers(noteId: string): Promise<string> {
		const note = await this.notesRepository.findOneBy({ id: noteId });
		if (note == null) return `Skipping announcement: note ${noteId} has been deleted`;

		// Re-checked here because the author may have lost the role between posting and this job running.
		const author = await this.cacheService.findUserById(note.userId);
		if (author.isSuspended || !await this.roleService.isAdministrator(author)) {
			return `Skipping announcement: author of note ${noteId} is no longer an active administrator`;
		}

		const progressKey = `announcementNote:progress:${noteId}`;
		let cursor = await this.redisClient.get(progressKey);
		let notified = 0;
		let users: MiLocalUser[];

		do {
			const query = this.usersRepository.createQueryBuilder('user')
				.where('user.host IS NULL')
				.andWhere('user.isDeleted = false')
				.andWhere('user.isSuspended = false')
				.andWhere('user.id != :authorId', { authorId: note.userId })
				.orderBy('user.id', 'ASC')
				.limit(batchSize);
			if (cursor != null) query.andWhere('user.id > :cursor', { cursor });

			users = await query.getMany() as MiLocalUser[];
			if (users.length === 0) break;

			const recipients = users.filter(user => this.utilityService.isActiveLocalUser(user) && !isSystemAccount(user));
			await Promise.all(recipients.map(user =>
				this.notificationService.createNotificationImmediate(user.id, 'announcementNote', { noteId }, null, { notifieeUser: user })));
			notified += recipients.length;

			cursor = users[users.length - 1].id;
			await this.redisClient.set(progressKey, cursor, 'EX', progressTtlSeconds);
		} while (users.length === batchSize);

		return `Announced note ${noteId} to ${notified} users`;
	}
}
