/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RegistryApiService } from '@/core/RegistryApiService.js';

export const meta = {
	requireCredential: true,
	secure: true,

	res: {
		type: 'array',
		items: {
			type: 'object',
			properties: {
				scopes: {
					type: 'array',
					items: {
						type: 'array',
						items: {
							type: 'string',
						}
					}
				},
				domain: {
					type: 'string',
					nullable: true,
				},
			},
		},
	},

	// 2 calls per second
	limit: {
		duration: 1000,
		max: 2,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private registryApiService: RegistryApiService,
	) {
		super(meta, paramDef, async (ps, me) => {
			return await this.registryApiService.getAllScopeAndDomains(me.id);
		});
	}
}
