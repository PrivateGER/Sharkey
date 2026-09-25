/*
 * SPDX-FileCopyrightText: piuvas and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiLoggerService } from '@/server/api/ApiLoggerService.js';
import { RoleService } from '@/core/RoleService.js';
import { CacheService } from '@/core/CacheService.js';
import { ListenBrainzService } from '@/core/ListenBrainzService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { Schema } from '@/misc/json-schema.js';
import { ApiError } from '../../error.js';
import { IEndpointMeta } from '../../endpoints.js';

export const meta = {
	tags: ['users'],

	requireCredential: false,

	description: 'Fetch what the user is listening to.',

	res: {
		type: 'object',
		optional: true, nullable: false,
		properties: {
			title: { type: 'string', optional: false, nullable: false },
			artist: { type: 'string', optional: false, nullable: false },
			coverArt: { type: 'string', optional: true, nullable: false },
			listenbrainzUrl: { type: 'string', optional: true, nullable: false },
			musicbrainzUrl: { type: 'string', optional: true, nullable: false },
		},
	},

	errors: {
		noListenbrainz: {
			message: 'The user does not have a listenbrainz url.',
			code: 'NO_LISTENBRAINZ',
			id: '93b56660-3c52-4d47-9d5a-d57b0dd38f0a',
		},
		listenbrainzError: {
			message: 'Error while fetching ListenBrainz data. Contact an instance administrator.',
			code: 'LISTENBRAINZ_ERROR',
			id: '42d2d282-0acd-432c-9431-d1504291e3fb',
		},
	},

	limit: {
		type: 'bucket',
		size: 20,
		dripRate: 200,
	},
} as const satisfies IEndpointMeta;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const satisfies Schema;

const ERROR_MAP = {
	'a72ff178-1c31-4f04-b2df-96ac5f6f3d5d': meta.errors.noListenbrainz,
	'0a571121-d49d-4866-bb5b-b1656ee649b8': meta.errors.listenbrainzError,
} as const satisfies Record<string, typeof meta.errors[keyof typeof meta.errors]>;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private readonly loggerService: ApiLoggerService,
		private readonly roleService: RoleService,
		private readonly cacheService: CacheService,
		private listenBrainzService: ListenBrainzService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const canUseApiKey = !!me && (await this.roleService.getUserPolicies(me)).canFetchLBMetadata;
				const profile = await this.cacheService.userProfileCache.fetch(ps.userId);
				return listenBrainzService.fetchForUser(profile, canUseApiKey);
			} catch (err) {
				if (err instanceof IdentifiableError) {
					throw new ApiError(ERROR_MAP[err.id]);
				}
				throw err;
			}
		});
	}
}
