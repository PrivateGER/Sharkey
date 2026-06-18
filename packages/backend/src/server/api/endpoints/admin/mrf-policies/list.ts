/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MrfPoliciesRepository } from '@/models/_.js';

export const meta = {
	tags: ['admin'],
	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:federation',
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.mrfPoliciesRepository)
		private readonly mrfPoliciesRepository: MrfPoliciesRepository,
	) {
		super(meta, paramDef, async () => {
			const policies = await this.mrfPoliciesRepository.find({
				order: {
					priority: 'ASC',
					id: 'ASC',
				},
			});

			return policies.map(policy => ({
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
			}));
		});
	}
}
