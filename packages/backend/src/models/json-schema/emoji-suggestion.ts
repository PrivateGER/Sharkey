/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const packedEmojiSuggestionSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			format: 'id',
			optional: false,
			nullable: false,
		},
		createdAt: {
			type: 'string',
			format: 'date-time',
			optional: false,
			nullable: false,
		},
		name: {
			type: 'string',
			optional: false,
			nullable: false,
		},
		category: {
			type: 'string',
			optional: false,
			nullable: true,
		},
		aliases: {
			type: 'array',
			optional: false,
			nullable: false,
			items: {
				type: 'string',
				optional: false,
				nullable: false,
			},
		},
		license: {
			type: 'string',
			optional: false,
			nullable: true,
		},
		localOnly: {
			type: 'boolean',
			optional: false,
			nullable: false,
		},
		isSensitive: {
			type: 'boolean',
			optional: false,
			nullable: false,
		},
		url: {
			type: 'string',
			optional: false,
			nullable: false,
		},
		user: {
			type: 'object',
			optional: false,
			nullable: false,
			ref: 'UserLite',
		},
	},
} as const;
