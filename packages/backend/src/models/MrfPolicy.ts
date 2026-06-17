/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { MrfLuaParams, MrfLuaParamsSchema } from '@/core/activitypub/mrf/MrfLuaPolicyService.js';
import { id } from './util/id.js';

export const mrfPolicyFailureModes = ['reject', 'accept'] as const;
export type MrfPolicyFailureMode = typeof mrfPolicyFailureModes[number];

@Index('IDX_mrf_policy_enabled_priority', ['enabled', 'priority'])
@Index('IDX_mrf_policy_builtinPolicyId', ['builtinPolicyId'], { unique: true })
@Entity('mrf_policy')
export class MiMrfPolicy {
	@PrimaryColumn(id())
	public id: string;

	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public createdAt: Date;

	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public updatedAt: Date;

	@Column('varchar', {
		length: 256,
	})
	public name: string;

	@Column('boolean', {
		default: true,
	})
	public enabled: boolean;

	@Column('integer', {
		default: 1000,
	})
	public priority: number;

	@Column('text')
	public source: string;

	@Column('integer', {
		default: 50,
	})
	public timeoutMs: number;

	@Column('varchar', {
		length: 32,
		default: 'reject',
	})
	public failureMode: MrfPolicyFailureMode;

	@Column('boolean', {
		default: false,
	})
	public isBuiltin: boolean;

	@Column('varchar', {
		length: 128,
		nullable: true,
	})
	public builtinPolicyId: string | null;

	@Column('jsonb', {
		default: {},
	})
	public paramsSchema: MrfLuaParamsSchema;

	@Column('jsonb', {
		default: {},
	})
	public params: MrfLuaParams;
}
