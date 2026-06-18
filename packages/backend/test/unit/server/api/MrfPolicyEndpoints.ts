/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as assert from 'node:assert';
import UpdateMrfPolicyEndpoint from '@/server/api/endpoints/admin/mrf-policies/update.js';
import DeleteMrfPolicyEndpoint from '@/server/api/endpoints/admin/mrf-policies/delete.js';
import CreateMrfPolicyEndpoint from '@/server/api/endpoints/admin/mrf-policies/create.js';
import { meta as listMeta } from '@/server/api/endpoints/admin/mrf-policies/list.js';
import { ApiError } from '@/server/api/error.js';

function createPolicy(overrides: Record<string, unknown> = {}) {
	return {
		id: 'mrftestbuiltin000000000000001',
		createdAt: new Date('2026-06-14T00:00:00.000Z'),
		updatedAt: new Date('2026-06-14T00:00:00.000Z'),
		name: 'Built-in policy',
		enabled: true,
		priority: 10,
		source: 'function filter(ctx) return mrf.accept() end',
		timeoutMs: 50,
		scope: {
			activityTypes: ['Create'],
			objectTypes: ['Note'],
		},
		isBuiltin: true,
		builtinPolicyId: 'keyword-filter',
		paramsSchema: {
			keywords: {
				type: 'string_array',
				default: ['spam'],
			},
		},
		params: {},
		...overrides,
	};
}

function createRepository(policy = createPolicy()) {
	let current = policy;
	return {
		findOneBy: async ({ id }: { id: string }) => id === current.id ? current : null,
		findOneByOrFail: async ({ id }: { id: string }) => {
			if (id !== current.id) throw new Error('not found');
			return current;
		},
		update: async (id: string, updates: Record<string, unknown>) => {
			if (id === current.id) {
				current = {
					...current,
					...updates,
				};
			}
			return { affected: id === current.id ? 1 : 0 };
		},
		delete: async (id: string) => ({ affected: id === current.id ? 1 : 0 }),
		insertOne: async (policy: Record<string, unknown>) => {
			current = {
				...createPolicy({
					isBuiltin: false,
					builtinPolicyId: null,
				}),
				...policy,
				createdAt: new Date('2026-06-14T00:00:00.000Z'),
				updatedAt: new Date('2026-06-14T00:00:00.000Z'),
			};
			return current;
		},
		get current() {
			return current;
		},
	};
}

describe('MRF policy admin endpoints', () => {
	test('requires administrator privileges to list policy source', () => {
		assert.equal(listMeta.requireAdmin, true);
		assert.equal('requireModerator' in listMeta, false);
	});

	test('allows disabling built-in policies without modifying their source', async () => {
		const repository = createRepository();
		const endpoint = new UpdateMrfPolicyEndpoint(repository as any);

		const result = await endpoint.exec({
			id: repository.current.id,
			enabled: false,
		}, {} as any, null);

		assert.equal(result.enabled, false);
		assert.equal(result.isBuiltin, true);
		assert.equal(result.builtinPolicyId, 'keyword-filter');
		assert.equal(repository.current.source, 'function filter(ctx) return mrf.accept() end');
	});

	test('allows updating built-in policy params', async () => {
		const repository = createRepository();
		const endpoint = new UpdateMrfPolicyEndpoint(repository as any);

		const result = await endpoint.exec({
			id: repository.current.id,
			params: {
				keywords: ['custom'],
			},
		}, {} as any, null);

		assert.deepStrictEqual(result.params, {
			keywords: ['custom'],
		});
		assert.equal(repository.current.source, 'function filter(ctx) return mrf.accept() end');
	});

	test('rejects unknown built-in policy params', async () => {
		const repository = createRepository();
		const endpoint = new UpdateMrfPolicyEndpoint(repository as any);

		await assert.rejects(
			() => endpoint.exec({
				id: repository.current.id,
				params: {
					unknown: true,
				},
			}, {} as any, null),
			(error: unknown) => error instanceof ApiError && error.code === 'INVALID_MRF_POLICY_PARAMS',
		);
	});

	test('extracts params schema when creating custom policies', async () => {
		const repository = createRepository();
		const endpoint = new CreateMrfPolicyEndpoint(repository as any, {
			gen: () => 'mrfcustom00000000000000000001',
		} as any);

		const result = await endpoint.exec({
			name: 'Custom policy',
			source: `
				policy = {
					params = {
						threshold = {
							type = "integer",
							default = 4,
						},
					},
				}

				function filter(ctx)
					return mrf.accept()
				end
			`,
			params: {
				threshold: 9,
			},
		}, {} as any, null);

		assert.equal(result.isBuiltin, false);
		assert.deepStrictEqual(result.paramsSchema, {
			threshold: {
				type: 'integer',
				default: 4,
			},
		});
		assert.deepStrictEqual(result.params, {
			threshold: 9,
		});
		assert.deepStrictEqual(result.scope, {
			activityTypes: ['Create'],
			objectTypes: ['Note'],
		});
	});

	test('returns warnings for custom policy source globals when creating policies', async () => {
		const repository = createRepository();
		const endpoint = new CreateMrfPolicyEndpoint(repository as any, {
			gen: () => 'mrfcustom00000000000000000002',
		} as any);

		const result = await endpoint.exec({
			name: 'Custom policy with globals',
			source: `
				counter = 0

				function filter(ctx)
					return mrf.accept()
				end
			`,
		}, {} as any, null);

		assert.deepStrictEqual(result.warnings.map((warning: { code: string; key: string }) => ({
			code: warning.code,
			key: warning.key,
		})), [
			{ code: 'persistent_global_defined', key: 'counter' },
		]);
	});

	test('allows custom policies to target non-note activity types', async () => {
		const repository = createRepository(createPolicy({
			isBuiltin: false,
			builtinPolicyId: null,
		}));
		const endpoint = new UpdateMrfPolicyEndpoint(repository as any);

		const result = await endpoint.exec({
			id: repository.current.id,
			scope: {
				activityTypes: ['Announce'],
				objectTypes: null,
			},
		}, {} as any, null);

		assert.deepStrictEqual(result.scope, {
			activityTypes: ['Announce'],
			objectTypes: null,
		});
		assert.deepStrictEqual(repository.current.scope, {
			activityTypes: ['Announce'],
			objectTypes: null,
		});
	});

	test('rejects source edits for built-in policies', async () => {
		const repository = createRepository();
		const endpoint = new UpdateMrfPolicyEndpoint(repository as any);

		await assert.rejects(
			() => endpoint.exec({
				id: repository.current.id,
				source: 'function filter(ctx) return mrf.reject("changed") end',
			}, {} as any, null),
			(error: unknown) => error instanceof ApiError && error.code === 'CANNOT_MODIFY_BUILTIN_MRF_POLICY',
		);
	});

	test('rejects scope edits for built-in policies', async () => {
		const repository = createRepository();
		const endpoint = new UpdateMrfPolicyEndpoint(repository as any);

		await assert.rejects(
			() => endpoint.exec({
				id: repository.current.id,
				scope: {
					activityTypes: ['Announce'],
					objectTypes: null,
				},
			}, {} as any, null),
			(error: unknown) => error instanceof ApiError && error.code === 'CANNOT_MODIFY_BUILTIN_MRF_POLICY',
		);
	});

	test('rejects deleting built-in policies', async () => {
		const repository = createRepository();
		const endpoint = new DeleteMrfPolicyEndpoint(repository as any);

		await assert.rejects(
			() => endpoint.exec({
				id: repository.current.id,
			}, {} as any, null),
			(error: unknown) => error instanceof ApiError && error.code === 'CANNOT_DELETE_BUILTIN_MRF_POLICY',
		);
	});
});
