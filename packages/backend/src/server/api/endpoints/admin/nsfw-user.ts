/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository } from '@/models/_.js';
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
	kind: 'write:admin:nsfw-user',

	errors: {
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: '991f47fc-0c4b-42e1-8ef1-49e1d79599cb',
			kind: 'permission',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userProfilesRepository)
		private readonly userProfilesRepository: UserProfilesRepository,
		private readonly moderationLogService: ModerationLogService,
		private readonly cacheService: CacheService,
		private readonly internalEventService: InternalEventService,
		private readonly roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const profile = await this.cacheService.userProfileCache.fetch(ps.userId);

			if (profile.alwaysMarkNsfw) return;

			const user = await this.cacheService.findUserById(ps.userId);

			if (!await this.roleService.isAdministrator(me) && await this.roleService.isModerator(user)) {
				throw new ApiError(meta.errors.accessDenied);
			}

			await this.userProfilesRepository.update(user.id, {
				alwaysMarkNsfw: true,
			});

			await this.internalEventService.emit('updateUserProfile', { userId: ps.userId, keys: ['alwaysMarkNsfw'] });

			await this.moderationLogService.log(me, 'nsfwUser', {
				userId: ps.userId,
				userUsername: user.username,
				userHost: user.host,
			});
		});
	}
}
