/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import { EmojiSuggestionEntityService } from '@/core/entities/EmojiSuggestionEntityService.js';
import type { MiEmojiSuggestion, MiUser } from '@/models/_.js';

describe('EmojiSuggestionEntityService', () => {
	test('remote suggestion previews expose only a media-proxy URL', async () => {
		const originalUrl = 'https://remote.example/emoji.png?size=large&theme=dark';
		const user = { id: '9abc000001' } as MiUser;
		const userEntityService = {
			pack: jest.fn(async () => ({ id: user.id })),
		};
		const moduleRef = {
			get: jest.fn(() => userEntityService),
		};
		const service = new EmojiSuggestionEntityService(
			moduleRef as never,
			{ mediaProxy: 'https://proxy.example' } as never,
			{ parse: jest.fn(() => ({ date: new Date('2026-08-13T00:00:00.000Z') })) } as never,
		);
		service.onModuleInit();

		const packed = await service.pack({
			id: '9abc000002',
			userId: user.id,
			user,
			fileId: null,
			file: null,
			remoteEmojiId: '9abc000003',
			remoteEmojiUrl: originalUrl,
			remoteEmojiHost: 'remote.example',
			name: 'party_blob',
			category: null,
			aliases: [],
			license: null,
			localOnly: false,
			isSensitive: false,
		} as MiEmojiSuggestion, user);

		const previewUrl = new URL(packed.url);
		expect(previewUrl.origin).toBe('https://proxy.example');
		expect(previewUrl.pathname).toBe('/emoji.webp');
		expect(previewUrl.searchParams.get('url')).toBe(originalUrl);
		expect(previewUrl.searchParams.get('emoji')).toBe('1');
		expect(packed.url).not.toBe(originalUrl);
	});
});
