/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const packedMrfPolicySchema = {
	type: 'object',
	properties: {
		id: { type: 'string', optional: false, nullable: false, format: 'id' },
		createdAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
		updatedAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
		name: { type: 'string', optional: false, nullable: false },
		enabled: { type: 'boolean', optional: false, nullable: false },
		priority: { type: 'number', optional: false, nullable: false },
		source: { type: 'string', optional: false, nullable: false },
		timeoutMs: { type: 'number', optional: false, nullable: false },
		scope: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				activityTypes: {
					type: 'array', optional: false, nullable: true,
					items: { type: 'string', optional: false, nullable: false },
				},
				objectTypes: {
					type: 'array', optional: false, nullable: true,
					items: { type: 'string', optional: false, nullable: false },
				},
			},
		},
		isBuiltin: { type: 'boolean', optional: false, nullable: false },
		builtinPolicyId: { type: 'string', optional: false, nullable: true },
		paramsSchema: { type: 'object', optional: false, nullable: false },
		params: { type: 'object', optional: false, nullable: false },
		warnings: {
			type: 'array', optional: true, nullable: false,
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
} as const;
