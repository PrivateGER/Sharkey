/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { EmojiSuggestionError } from '@/core/EmojiSuggestionService.js';

export const emojiSuggestionErrors = {
	noSuchFile: {
		message: 'No such file.',
		code: 'NO_SUCH_FILE',
		id: 'd7c980e6-221b-4b60-a50e-a6f77ac8f3f9',
	},
	unsupportedFileType: {
		message: 'Unsupported file type.',
		code: 'UNSUPPORTED_FILE_TYPE',
		id: '63a9ff92-f992-4bc9-9d43-9fe1ea0ea3ec',
	},
	noSuchRemoteEmoji: {
		message: 'No such remote emoji.',
		code: 'NO_SUCH_REMOTE_EMOJI',
		id: '413b2a5e-c6f5-47cf-b7ad-bb18d5eec9e9',
	},
	duplicateName: {
		message: 'An emoji with this name already exists.',
		code: 'DUPLICATE_NAME',
		id: '90a1f02e-45f9-4d19-a43e-a0e634b094ea',
	},
	duplicateSuggestion: {
		message: 'A matching emoji suggestion is already pending.',
		code: 'DUPLICATE_SUGGESTION',
		id: '7bdf044b-3753-484b-8d51-acd0ea2df264',
	},
	tooManyPendingSuggestions: {
		message: 'You have too many pending emoji suggestions.',
		code: 'TOO_MANY_PENDING_SUGGESTIONS',
		id: '16049091-cb93-45e6-a843-b9d9171bc6e5',
	},
	noSuchSuggestion: {
		message: 'No such emoji suggestion.',
		code: 'NO_SUCH_EMOJI_SUGGESTION',
		id: 'd023907b-288c-4d29-9e63-743b6ccc8320',
	},
} as const satisfies Record<EmojiSuggestionError, {
	message: string;
	code: string;
	id: string;
}>;

export const emojiSuggestionParamDef = {
	type: 'object',
	properties: {
		name: { type: 'string', maxLength: 128, pattern: '^[\\p{Letter}\\p{Number}\\p{Mark}_+-]+$' },
		fileId: { type: 'string', format: 'misskey:id' },
		remoteEmojiId: { type: 'string', format: 'misskey:id' },
		category: { type: 'string', nullable: true, maxLength: 128 },
		aliases: {
			type: 'array',
			maxItems: 100,
			items: { type: 'string', maxLength: 128 },
		},
		license: { type: 'string', nullable: true, maxLength: 1024 },
		isSensitive: { type: 'boolean' },
		localOnly: { type: 'boolean' },
	},
	required: ['name'],
	oneOf: [
		{ required: ['fileId'] },
		{ required: ['remoteEmojiId'] },
	],
} as const;

export const emojiSuggestionListParamDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: [],
} as const;

export const emojiSuggestionListResponse = {
	type: 'array',
	optional: false,
	nullable: false,
	items: {
		type: 'object',
		optional: false,
		nullable: false,
		ref: 'EmojiSuggestion',
	},
} as const;
