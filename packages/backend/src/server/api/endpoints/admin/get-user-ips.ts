/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UserIpsRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { CacheService } from '@/core/CacheService.js';
import { RoleService } from '@/core/RoleService.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'read:admin:user-ips',

	errors: {
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: 'b3f3a89c-d044-48c3-98eb-be2ae22cb934',
			kind: 'permission',
		},
	},
	res: {
		type: 'array',
		optional: false,
		nullable: false,
		items: {
			type: 'object',
			optional: false,
			nullable: false,
			properties: {
				ip: { type: 'string' },
				createdAt: {
					type: 'string',
					optional: false,
					nullable: false,
					format: 'date-time',
				},
			},
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
		@Inject(DI.userIpsRepository)
		private userIpsRepository: UserIpsRepository,

		private idService: IdService,
		private readonly cacheService: CacheService,
		private readonly roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const user = await this.cacheService.findUserById(ps.userId);

			if (!await this.roleService.isAdministrator(me) && await this.roleService.isModerator(user)) {
				throw new ApiError(meta.errors.accessDenied);
			}

			const ips = await this.userIpsRepository.find({
				where: { userId: ps.userId },
				order: { id: 'DESC' },
				take: 30,
			});

			return ips.map(x => ({
				ip: x.ip,
				createdAt: x.createdAt.toISOString(),
			}));
		});
	}
}
