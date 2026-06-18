/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { MrfLuaParams, MrfLuaParamsSchema } from '@/core/activitypub/mrf/MrfLuaPolicyService.js';
import { id } from './util/id.js';

export const mrfPolicyFailureModes = ['reject', 'accept'] as const;
export type MrfPolicyFailureMode = typeof mrfPolicyFailureModes[number];
export const DEFAULT_MRF_POLICY_FAILURE_MODE = 'accept' satisfies MrfPolicyFailureMode;

export type MrfPolicyScope = {
	activityTypes: string[] | null;
	objectTypes: string[] | null;
};

export const DEFAULT_MRF_POLICY_SCOPE = {
	activityTypes: ['Create'],
	objectTypes: ['Note'],
} satisfies MrfPolicyScope;

export function normalizeMrfPolicyScope(scope: unknown): MrfPolicyScope {
	if (!isRecord(scope)) {
		return structuredClone(DEFAULT_MRF_POLICY_SCOPE);
	}

	return {
		activityTypes: normalizeScopeTypes(scope.activityTypes, DEFAULT_MRF_POLICY_SCOPE.activityTypes),
		objectTypes: normalizeScopeTypes(scope.objectTypes, DEFAULT_MRF_POLICY_SCOPE.objectTypes),
	};
}

function normalizeScopeTypes(value: unknown, fallback: string[] | null): string[] | null {
	if (value === null) return null;
	if (!Array.isArray(value)) return fallback == null ? null : [...fallback];

	const seen = new Set<string>();
	const types: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string' || item.length === 0) {
			return fallback == null ? null : [...fallback];
		}
		if (seen.has(item)) continue;
		seen.add(item);
		types.push(item);
	}
	return types;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
		default: DEFAULT_MRF_POLICY_FAILURE_MODE,
	})
	public failureMode: MrfPolicyFailureMode;

	@Column('jsonb', {
		default: DEFAULT_MRF_POLICY_SCOPE,
	})
	public scope: MrfPolicyScope;

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
