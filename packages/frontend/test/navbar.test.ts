/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const state: { queueChanged?: () => void } = {};
	return {
		api: vi.fn(),
		channelOn: vi.fn((event: string, handler: () => void) => {
			if (event === 'emojiSuggestionQueueChanged') state.queueChanged = handler;
		}),
		state,
	};
});

vi.mock('@@/js/config.js', () => ({ ui: null }));
vi.mock('@/utility/clear-cache.js', () => ({ clearCache: vi.fn() }));
vi.mock('@/instance.js', () => ({ instance: { enableAchievements: false } }));
vi.mock('@/i.js', () => ({
	$i: {
		id: '9abc000001',
		username: 'moderator',
		isAdmin: false,
		isModerator: true,
		policies: { chatAvailability: 'available' },
	},
}));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { setItem: vi.fn() } }));
vi.mock('@/ui/_common_/common.js', () => ({ openInstanceMenu: vi.fn(), openToolsMenu: vi.fn() }));
vi.mock('@/utility/lookup.js', () => ({ lookup: vi.fn() }));
vi.mock('@/os.js', () => ({ popup: vi.fn(), popupMenu: vi.fn() }));
vi.mock('@/i18n.js', () => ({
	i18n: { ts: new Proxy({}, { get: (_target, property) => String(property) }) },
}));
vi.mock('@/utility/unison-reload.js', () => ({ unisonReload: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/stream.js', () => ({
	useStream: () => ({
		useChannel: () => ({ on: mocks.channelOn }),
	}),
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(resolvePromise => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

test('emoji suggestion indicator follows queue events and ignores stale status responses', async () => {
	// The controlled initial response must exist before navbar's module-level fetch runs.
	const initial = deferred<Array<{ id: string }>>();
	mocks.api.mockReturnValueOnce(initial.promise);

	const navbar = await import('@/navbar.js');

	expect(mocks.api).toHaveBeenCalledWith('admin/emoji-suggestions/list', { limit: 1 });
	expect(mocks.channelOn).toHaveBeenCalledWith('emojiSuggestionQueueChanged', expect.any(Function));

	initial.resolve([{ id: '9abc000002' }]);
	await vi.waitFor(() => {
		expect(navbar.hasPendingEmojiSuggestions.value).toBe(true);
	});

	mocks.api.mockResolvedValueOnce([]);
	mocks.state.queueChanged?.();
	await vi.waitFor(() => {
		expect(navbar.hasPendingEmojiSuggestions.value).toBe(false);
	});

	const stale = deferred<Array<{ id: string }>>();
	mocks.api.mockReturnValueOnce(stale.promise);
	window.dispatchEvent(new Event('focus'));
	await vi.waitFor(() => {
		expect(mocks.api).toHaveBeenCalledTimes(3);
	});

	mocks.api.mockResolvedValueOnce([]);
	mocks.state.queueChanged?.();
	await vi.waitFor(() => {
		expect(mocks.api).toHaveBeenCalledTimes(4);
	});

	stale.resolve([{ id: '9abc000003' }]);
	await stale.promise;
	await Promise.resolve();
	expect(navbar.hasPendingEmojiSuggestions.value).toBe(false);
});
