/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import type { MrfPoliciesRepository } from '@/models/_.js';
import { DEFAULT_MRF_POLICY_SCOPE, normalizeMrfPolicyScope } from '@/models/MrfPolicy.js';
import { MrfLuaPolicyService } from '@/core/activitypub/mrf/MrfLuaPolicyService.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],
	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:federation',

	errors: {
		invalidParams: {
			message: 'Invalid MRF policy params.',
			code: 'INVALID_MRF_POLICY_PARAMS',
			id: '33231d77-34ed-4454-83a4-1f0d456acdf8',
		},
		invalidSource: {
			message: 'Invalid MRF policy source.',
			code: 'INVALID_MRF_POLICY_SOURCE',
			id: 'c9727ba3-6c83-46ba-9d34-1cf5d3c0b4c8',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1, maxLength: 256 },
		enabled: { type: 'boolean', default: true },
		priority: { type: 'integer', default: 1000 },
		source: { type: 'string', minLength: 1 },
		timeoutMs: { type: 'integer', minimum: 1, maximum: 5000, default: 50 },
		scope: {
			type: 'object',
			properties: {
				activityTypes: { type: 'array', nullable: true, items: { type: 'string', minLength: 1, maxLength: 128 }, maxItems: 64 },
				objectTypes: { type: 'array', nullable: true, items: { type: 'string', minLength: 1, maxLength: 128 }, maxItems: 64 },
			},
			additionalProperties: false,
			default: DEFAULT_MRF_POLICY_SCOPE,
		},
		params: { type: 'object', additionalProperties: true, default: {} },
	},
	required: ['name', 'source'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.mrfPoliciesRepository)
		private readonly mrfPoliciesRepository: MrfPoliciesRepository,
		private readonly idService: IdService,
		private readonly mrfLuaPolicyService: MrfLuaPolicyService,
	) {
		super(meta, paramDef, async (ps) => {
			let metadata;
			try {
				metadata = await this.mrfLuaPolicyService.extractPolicyMetadata({
					id: 'new-policy',
					name: ps.name,
					source: ps.source,
					timeoutMs: ps.timeoutMs,
				});
			} catch (error) {
				throw new ApiError(meta.errors.invalidSource, {
					reason: error instanceof Error ? error.message : String(error),
				});
			}
			const paramsSchema = metadata.paramsSchema;
			let params;
			try {
				params = this.mrfLuaPolicyService.validateParams(paramsSchema, ps.params ?? {});
			} catch (error) {
				throw new ApiError(meta.errors.invalidParams, {
					reason: error instanceof Error ? error.message : String(error),
				});
			}

			const policy = await this.mrfPoliciesRepository.insertOne({
				id: this.idService.gen(),
				name: ps.name,
				enabled: ps.enabled ?? true,
				priority: ps.priority ?? 1000,
				source: ps.source,
				timeoutMs: ps.timeoutMs ?? 50,
				scope: normalizeMrfPolicyScope(ps.scope ?? DEFAULT_MRF_POLICY_SCOPE),
				isBuiltin: false,
				builtinPolicyId: null,
				paramsSchema,
				params,
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
				warnings: metadata.warnings,
			};
		});
	}
}
