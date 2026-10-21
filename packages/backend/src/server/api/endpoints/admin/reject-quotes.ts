/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { CacheService } from '@/core/CacheService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { RoleService } from '@/core/RoleService.js';
import { ApiError } from '@/server/api/error.js';
import { InternalEventService } from '@/global/InternalEventService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:reject-quotes',

	errors: {
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: '8ccda560-2b7c-4dfc-90c8-c75250f4c71f',
			kind: 'permission',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		rejectQuotes: { type: 'boolean', nullable: false },
	},
	required: ['userId', 'rejectQuotes'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private readonly usersRepository: UsersRepository,

		private readonly cacheService: CacheService,
		private readonly moderationLogService: ModerationLogService,
		private readonly internalEventService: InternalEventService,
		private readonly roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const user = await this.cacheService.findUserById(ps.userId);

			if (!await this.roleService.isAdministrator(me) && await this.roleService.isModerator(user)) {
				throw new ApiError(meta.errors.accessDenied);
			}

			// Skip if there's nothing to do
			if (user.rejectQuotes === ps.rejectQuotes) return;

			await this.usersRepository.update(ps.userId, {
				rejectQuotes: ps.rejectQuotes,
			});

			// Synchronize caches and other processes
			await this.internalEventService.emit('userUpdated', { id: ps.userId });

			await this.moderationLogService.log(me, ps.rejectQuotes ? 'rejectQuotesUser' : 'acceptQuotesUser', {
				userId: user.id,
				userUsername: user.username,
				userHost: user.host,
			});
		});
	}
}
