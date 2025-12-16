/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { QUEUE_TYPES, QueueService } from '@/core/QueueService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'read:admin:queue',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				name: {
					type: 'string',
					optional: false, nullable: false,
				},
				counts: {
					type: 'object',
					optional: false, nullable: false,
					additionalProperties: {
						optional: false, nullable: false,
						type: 'number',
					},
				},
				isPaused: {
					type: 'boolean',
					optional: false, nullable: false,
				},
				metrics: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						completed: {
							type: 'object',
							optional: false, nullable: false,
							properties: {
								meta: {
									type: 'object',
									optional: false, nullable: false,
									properties: {
										count: {
											type: 'number',
											optional: false, nullable: false,
										},
										prevTS: {
											type: 'number',
											optional: false, nullable: false,
										},
										prevCount: {
											type: 'number',
											optional: false, nullable: false,
										},
									},
								},
								data: {
									type: 'array',
									optional: false, nullable: false,
									items: {
										type: 'number',
										optional: false, nullable: false,
									},
								},
								count: {
									type: 'number',
									optional: false, nullable: false,
								},
							},
						},
						failed: {
							type: 'object',
							optional: false, nullable: false,
							properties: {
								meta: {
									type: 'object',
									optional: false, nullable: false,
									properties: {
										count: {
											type: 'number',
											optional: false, nullable: false,
										},
										prevTS: {
											type: 'number',
											optional: false, nullable: false,
										},
										prevCount: {
											type: 'number',
											optional: false, nullable: false,
										},
									},
								},
								data: {
									type: 'array',
									optional: false, nullable: false,
									items: {
										type: 'number',
										optional: false, nullable: false,
									},
								},
								count: {
									type: 'number',
									optional: false, nullable: false,
								},
							},
						},
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private queueService: QueueService,
	) {
		super(meta, paramDef, async (ps, me) => {
			return await this.queueService.queueGetQueues();
		});
	}
}
