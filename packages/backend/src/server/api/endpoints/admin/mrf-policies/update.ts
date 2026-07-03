/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MrfPoliciesRepository } from '@/models/_.js';
import type { MiMrfPolicy } from '@/models/MrfPolicy.js';
import { normalizeMrfPolicyScope } from '@/models/MrfPolicy.js';
import { MrfLuaPolicyService } from '@/core/activitypub/mrf/MrfLuaPolicyService.js';
import type { MrfLuaPolicyWarning } from '@/core/activitypub/mrf/MrfLuaPolicyService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],
	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:federation',

	errors: {
		noSuchPolicy: {
			message: 'No such MRF policy.',
			code: 'NO_SUCH_MRF_POLICY',
			id: '7f0b839e-527f-49d0-b56a-c5db4f7596c9',
		},
		cannotModifyBuiltinPolicy: {
			message: 'Built-in MRF policies cannot be modified. Create a custom copy and disable the built-in policy instead.',
			code: 'CANNOT_MODIFY_BUILTIN_MRF_POLICY',
			id: 'ab931093-a145-47d2-aa4f-863b62ad0625',
		},
		invalidParams: {
			message: 'Invalid MRF policy params.',
			code: 'INVALID_MRF_POLICY_PARAMS',
			id: '5e19454b-3100-4354-9dfd-f2187ec1fe14',
		},
		invalidSource: {
			message: 'Invalid MRF policy source.',
			code: 'INVALID_MRF_POLICY_SOURCE',
			id: '2f4bd3d7-2c86-4a0f-bd35-6d1f4f9b1b0a',
		},
	},

	res: {
		type: 'object',
		ref: 'MrfPolicy',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id' },
		name: { type: 'string', minLength: 1, maxLength: 256 },
		enabled: { type: 'boolean' },
		priority: { type: 'integer' },
		source: { type: 'string', minLength: 1 },
		timeoutMs: { type: 'integer', minimum: 1, maximum: 5000, description: 'Wall-clock budget per execution in milliseconds. Time spent awaiting mrf.lookup.* database calls counts against this budget.' },
		scope: {
			type: 'object',
			description: 'Activity/object type filter. objectTypes only matches inline objects; activities whose object is a bare URI string (e.g. Announce, Like, Delete) never match a non-null objectTypes — use objectTypes: null to receive those.',
			properties: {
				activityTypes: { type: 'array', nullable: true, items: { type: 'string', minLength: 1, maxLength: 128 }, maxItems: 64 },
				objectTypes: { type: 'array', nullable: true, items: { type: 'string', minLength: 1, maxLength: 128 }, maxItems: 64 },
			},
			additionalProperties: false,
		},
		params: { type: 'object', additionalProperties: true },
	},
	required: ['id'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.mrfPoliciesRepository)
		private readonly mrfPoliciesRepository: MrfPoliciesRepository,
		private readonly mrfLuaPolicyService: MrfLuaPolicyService,
		private readonly moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const existing = await this.mrfPoliciesRepository.findOneBy({ id: ps.id });
			if (existing == null) throw new ApiError(meta.errors.noSuchPolicy);
			if (existing.isBuiltin && (
				ps.name !== undefined ||
				ps.source !== undefined ||
				ps.timeoutMs !== undefined ||
				ps.scope !== undefined
			)) {
				throw new ApiError(meta.errors.cannotModifyBuiltinPolicy);
			}

			let paramsSchema = existing.paramsSchema;
			let params = existing.params;
			let warnings: MrfLuaPolicyWarning[] = [];
			if (ps.source !== undefined) {
				let metadata;
				try {
					metadata = await this.mrfLuaPolicyService.extractPolicyMetadata({
						id: existing.id,
						name: ps.name ?? existing.name,
						source: ps.source,
						timeoutMs: ps.timeoutMs ?? existing.timeoutMs,
					});
				} catch (error) {
					throw new ApiError(meta.errors.invalidSource, {
						reason: error instanceof Error ? error.message : String(error),
					});
				}
				paramsSchema = metadata.paramsSchema;
				warnings = metadata.warnings;
				params = this.mrfLuaPolicyService.filterCompatibleParams(paramsSchema, params);
			}
			if (ps.params !== undefined) {
				try {
					params = this.mrfLuaPolicyService.validateParams(paramsSchema, ps.params);
				} catch (error) {
					throw new ApiError(meta.errors.invalidParams, {
						reason: error instanceof Error ? error.message : String(error),
					});
				}
			}

			const updates: Partial<MiMrfPolicy> = {
				...(ps.name !== undefined ? { name: ps.name } : {}),
				...(ps.enabled !== undefined ? { enabled: ps.enabled } : {}),
				...(ps.priority !== undefined ? { priority: ps.priority } : {}),
				...(ps.source !== undefined ? { source: ps.source } : {}),
				...(ps.timeoutMs !== undefined ? { timeoutMs: ps.timeoutMs } : {}),
				...(ps.scope !== undefined ? { scope: normalizeMrfPolicyScope(ps.scope) } : {}),
				...(ps.source !== undefined ? { paramsSchema } : {}),
				...(ps.source !== undefined || ps.params !== undefined ? { params } : {}),
				updatedAt: new Date(),
			};
			await this.mrfPoliciesRepository.update(ps.id, updates);

			const policy = await this.mrfPoliciesRepository.findOneByOrFail({ id: ps.id });

			await this.moderationLogService.log(me, 'updateMrfPolicy', {
				policyId: policy.id,
				before: existing,
				after: policy,
			});

			return {
				id: policy.id,
				createdAt: policy.createdAt.toISOString(),
				updatedAt: policy.updatedAt.toISOString(),
				name: policy.name,
				enabled: policy.enabled,
				priority: policy.priority,
				source: policy.source,
				timeoutMs: policy.timeoutMs,
				scope: policy.scope,
				isBuiltin: policy.isBuiltin,
				builtinPolicyId: policy.builtinPolicyId,
				paramsSchema: policy.paramsSchema,
				params: policy.params,
				warnings,
			};
		});
	}
}
