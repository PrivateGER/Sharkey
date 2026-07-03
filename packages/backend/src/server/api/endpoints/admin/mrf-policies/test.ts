/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { IActivity } from '@/core/activitypub/type.js';
import { MrfLuaPolicyService } from '@/core/activitypub/mrf/MrfLuaPolicyService.js';
import { TimeService } from '@/global/TimeService.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],
	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:federation',

	errors: {
		luaFailed: {
			message: 'The MRF policy failed to load or run.',
			code: 'MRF_POLICY_LUA_FAILED',
			id: '8e2c9b0d-51f3-4c7a-9c25-6a3f6d0e4b91',
		},
	},

	res: {
		type: 'object',
		properties: {
			policy: {
				type: 'object', optional: false, nullable: false,
				properties: {
					id: { type: 'string', optional: false, nullable: false },
					name: { type: 'string', optional: false, nullable: false },
				},
			},
			decision: {
				type: 'object', optional: false, nullable: false,
				properties: {
					action: { type: 'string', optional: false, nullable: false },
					reason: { type: 'string', optional: true, nullable: false },
					activity: { type: 'object', optional: true, nullable: false },
				},
			},
			durationMs: { type: 'number', optional: false, nullable: false },
			paramsSchema: { type: 'object', optional: false, nullable: false },
			params: { type: 'object', optional: false, nullable: false },
			warnings: {
				type: 'array', optional: false, nullable: false,
				items: {
					type: 'object', optional: false, nullable: false,
					properties: {
						code: { type: 'string', optional: false, nullable: false },
						key: { type: 'string', optional: false, nullable: false },
						message: { type: 'string', optional: false, nullable: false },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		source: { type: 'string', minLength: 1 },
		activity: { type: 'object', additionalProperties: true },
		actor: { type: 'object', additionalProperties: true },
		localHost: { type: 'string', default: 'example.com' },
		signerHost: { type: 'string', default: 'remote.example' },
		timeoutMs: { type: 'integer', minimum: 1, maximum: 5000, default: 50 },
		params: { type: 'object', additionalProperties: true, default: {} },
	},
	required: ['source', 'activity', 'actor'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private readonly mrfLuaPolicyService: MrfLuaPolicyService,
		private readonly timeService: TimeService,
	) {
		super(meta, paramDef, async (ps) => {
			const policy = {
				id: 'dry-run',
				name: 'Dry run',
				source: ps.source,
				timeoutMs: ps.timeoutMs,
			};
			let metadata;
			try {
				metadata = await this.mrfLuaPolicyService.extractPolicyMetadata(policy);
			} catch (error) {
				throw new ApiError(meta.errors.luaFailed, {
					reason: error instanceof Error ? error.message : String(error),
				});
			}
			const paramsSchema = metadata.paramsSchema;
			// Dry run: tolerate params that no longer match the (possibly just-edited) source
			// by dropping incompatible ones, rather than hard-failing mid-iteration.
			const params = this.mrfLuaPolicyService.filterCompatibleParams(paramsSchema, ps.params ?? {});
			let result;
			try {
				result = await this.mrfLuaPolicyService.run({
					...policy,
					paramsSchema,
					params,
				}, {
					activity: ps.activity as IActivity,
					actor: {
						uri: typeof ps.actor.uri === 'string' ? ps.actor.uri : '',
						host: typeof ps.actor.host === 'string' ? ps.actor.host : null,
						followersCount: typeof ps.actor.followersCount === 'number' ? ps.actor.followersCount : undefined,
						followingCount: typeof ps.actor.followingCount === 'number' ? ps.actor.followingCount : undefined,
					},
					localHost: ps.localHost,
					signerHost: ps.signerHost,
					receivedAt: this.timeService.date.toISOString(),
				});
			} catch (error) {
				throw new ApiError(meta.errors.luaFailed, {
					reason: error instanceof Error ? error.message : String(error),
				});
			}

			return {
				...result,
				paramsSchema,
				params,
				warnings: dedupeWarnings([
					...metadata.warnings,
					...result.warnings,
				]),
			};
		});
	}
}

function dedupeWarnings<T extends { code: string; key: string; message: string }>(warnings: T[]): T[] {
	const deduped = new Map<string, T>();
	for (const warning of warnings) {
		deduped.set(`${warning.code}:${warning.key}:${warning.message}`, warning);
	}
	return [...deduped.values()];
}
