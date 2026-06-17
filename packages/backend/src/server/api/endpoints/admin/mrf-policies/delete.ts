/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { MrfPoliciesRepository } from '@/models/_.js';
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
			id: '67e53d9b-c972-49a4-86bd-15a448c4cbf0',
		},
		cannotDeleteBuiltinPolicy: {
			message: 'Built-in MRF policies cannot be deleted. Disable them instead.',
			code: 'CANNOT_DELETE_BUILTIN_MRF_POLICY',
			id: '9850e3d2-3846-471d-a3db-662650228516',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id' },
	},
	required: ['id'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.mrfPoliciesRepository)
		private readonly mrfPoliciesRepository: MrfPoliciesRepository,
	) {
		super(meta, paramDef, async (ps) => {
			const existing = await this.mrfPoliciesRepository.findOneBy({ id: ps.id });
			if (existing == null) throw new ApiError(meta.errors.noSuchPolicy);
			if (existing.isBuiltin) throw new ApiError(meta.errors.cannotDeleteBuiltinPolicy);

			const result = await this.mrfPoliciesRepository.delete(ps.id);
			if (result.affected === 0) throw new ApiError(meta.errors.noSuchPolicy);
		});
	}
}
