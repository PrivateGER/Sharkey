/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import type { Component } from 'vue';
import { cleanup, render } from '@testing-library/vue';
import type * as Misskey from 'misskey-js';
import { preferState } from './init.js';
import { useNoteReplies, useThreadReplies } from '@/use/use-note-replies.js';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

// The note stream, as seen by the page: whatever the server sends for the notes it subscribed to.
const stream = vi.hoisted(() => {
	const listeners = new Set<(event: unknown) => void>();
	return {
		listeners,
		noteUpdated: (event: { id: string; type: string; body?: unknown }) => {
			for (const listener of listeners) listener(event);
		},
	};
});

vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/i.js', () => ({ $i: { id: 'viewer' } }));
vi.mock('@/os.js', () => ({ popupMenu: vi.fn() }));
vi.mock('@/stream.js', () => ({
	useStream: () => ({
		on: (type: string, listener: (event: unknown) => void) => {
			if (type === 'noteUpdated') stream.listeners.add(listener);
		},
		off: (type: string, listener: (event: unknown) => void) => {
			stream.listeners.delete(listener);
		},
		send: () => {},
	}),
}));

// Lets each test decide when the reply list counts as having been on screen.
let showOnScreen: (el: Element) => void = () => {};
class FakeIntersectionObserver {
	private readonly targets = new Set<Element>();
	constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
		showOnScreen = el => {
			if (this.targets.has(el)) callback([{ target: el, isIntersecting: true }]);
		};
	}
	observe(el: Element) { this.targets.add(el); }
	disconnect() { this.targets.clear(); }
}

function note(id: string, userId = 'someone'): Misskey.entities.Note {
	return { id, userId, createdAt: '2026-01-01T00:00:00.000Z' } as Misskey.entities.Note;
}

const ids = (notes: Misskey.entities.Note[]) => notes.map(n => n.id);
const announce = (id: string, userId = 'someone') => ({ id, userId });

// Composables using provide/inject only work during a component's setup.
function inSetup<T>(build: () => T, child?: Component) {
	const captured: { value?: T } = {};
	const component = defineComponent({
		setup() {
			captured.value = build();
			return () => (child ? h(child) : null);
		},
	});
	return { component, captured };
}

function renderThread(childrenOf: Record<string, Misskey.entities.Note[]>, slowReplies: Record<string, Promise<Misskey.entities.Note>> = {}) {
	mocks.api.mockImplementation(async (endpoint: string, params: { noteId: string }) => {
		if (endpoint === 'notes/show') return slowReplies[params.noteId] ?? note(params.noteId);
		return childrenOf[params.noteId] ?? [];
	});

	const backfilling = ref(false);
	const listEl = ref<HTMLElement | null>(window.document.createElement('div'));
	const headerEl = ref<HTMLElement | null>(window.document.createElement('div'));
	const nested = inSetup(() => useNoteReplies(ref(note('r1')), 5));
	const thread = inSetup(() => {
		const replies = useThreadReplies({ backfilling, listEl, headerEl });
		return { replies, root: useNoteReplies(ref(note('root')), 30, { thread: replies.thread, placeWhileEmpty: true }) };
	}, nested.component);
	render(thread.component);

	return {
		backfilling,
		thread: thread.captured.value!.replies,
		root: thread.captured.value!.root,
		nested: nested.captured.value!,
		seeReplies: () => showOnScreen(listEl.value!),
	};
}

beforeEach(() => {
	vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
	preferState.threadReplySort = 'newest';
	preferState.threadReplyArrival = 'hold';
});

afterEach(() => {
	cleanup();
	mocks.api.mockReset();
	vi.unstubAllGlobals();
});

test('replies arriving during a backfill wait until shown, anywhere in the thread, then take their places', async () => {
	const t = renderThread({ root: [note('r3'), note('r1')] });
	await t.root.load();
	await t.nested.load();
	t.seeReplies();
	t.backfilling.value = true;

	// An older reply that belongs between the listed ones, and one under an existing reply.
	expect(await t.root.add(announce('r2'))).toBe(true);
	expect(await t.nested.add(announce('r1a'))).toBe(true);

	expect(ids(t.root.replies.value)).toEqual(['r3', 'r1']);
	expect(t.nested.replies.value).toEqual([]);
	expect(t.thread.pendingCount.value).toBe(2);

	await t.thread.showAllPending();

	expect(ids(t.root.replies.value)).toEqual(['r3', 'r2', 'r1']);
	expect(ids(t.nested.replies.value)).toEqual(['r1a']);
	expect(t.thread.pendingCount.value).toBe(0);
});

test('viewers who want replies right away get them in place, even nested and during a backfill', async () => {
	preferState.threadReplyArrival = 'live';
	const t = renderThread({ root: [note('r3'), note('r1')] });
	await t.root.load();
	await t.nested.load();
	t.seeReplies();
	t.backfilling.value = true;

	await t.root.add(announce('r2'));
	await t.nested.add(announce('r1a'));

	expect(ids(t.root.replies.value)).toEqual(['r3', 'r2', 'r1']);
	expect(ids(t.nested.replies.value)).toEqual(['r1a']);
	expect(t.thread.pendingCount.value).toBe(0);
});

test('a reply announced during a backfill stays held when it finishes loading after the backfill ended', async () => {
	let finishLoading!: (reply: Misskey.entities.Note) => void;
	const slowReply = new Promise<Misskey.entities.Note>(resolve => {
		finishLoading = resolve;
	});
	const t = renderThread({ root: [note('r3'), note('r1')] }, { r2: slowReply, r1a: slowReply.then(() => note('r1a')) });
	await t.root.load();
	await t.nested.load();
	t.seeReplies();
	t.backfilling.value = true;

	const rootAdded = t.root.add(announce('r2'));
	const nestedAdded = t.nested.add(announce('r1a'));
	t.backfilling.value = false;
	finishLoading(note('r2'));
	await Promise.all([rootAdded, nestedAdded]);

	expect(ids(t.root.replies.value)).toEqual(['r3', 'r1']);
	expect(t.nested.replies.value).toEqual([]);
	expect(t.thread.pendingCount.value).toBe(2);
});

test('the viewer\'s own reply is listed right away even during a backfill', async () => {
	const t = renderThread({ root: [note('r1')] });
	await t.root.load();
	t.seeReplies();
	t.backfilling.value = true;

	await t.root.add(announce('r2', 'viewer'));

	expect(ids(t.root.replies.value)).toEqual(['r2', 'r1']);
	expect(t.thread.pendingCount.value).toBe(0);
});

test('replies are listed right away when nobody can be reading them yet', async () => {
	const t = renderThread({ root: [note('r1')] });
	await t.root.load();
	t.backfilling.value = true;

	// The replies haven't been on screen yet.
	await t.root.add(announce('r2'));
	expect(ids(t.root.replies.value)).toEqual(['r2', 'r1']);

	// After the backfill, nothing is held either.
	t.seeReplies();
	t.backfilling.value = false;
	await t.root.add(announce('r3'));
	expect(ids(t.root.replies.value)).toEqual(['r3', 'r2', 'r1']);
	expect(t.thread.pendingCount.value).toBe(0);
});

test('a thread with no listed replies fills directly, but an empty sub-thread still holds', async () => {
	const t = renderThread({});
	await t.root.load();
	await t.nested.load();
	t.seeReplies();
	t.backfilling.value = true;

	await t.root.add(announce('r1'));
	await t.nested.add(announce('r1a'));

	expect(ids(t.root.replies.value)).toEqual(['r1']);
	expect(t.nested.replies.value).toEqual([]);
	expect(t.thread.pendingCount.value).toBe(1);
});

test('a reload during a backfill keeps held replies out even though the server returns them', async () => {
	const childrenOf: Record<string, Misskey.entities.Note[]> = { root: [note('r1')] };
	const t = renderThread(childrenOf);
	await t.root.load();
	t.seeReplies();
	t.backfilling.value = true;

	await t.root.add(announce('r2'));
	childrenOf.root = [note('r2'), note('r1')];
	await t.root.load();

	expect(ids(t.root.replies.value)).toEqual(['r1']);
	expect(t.thread.pendingCount.value).toBe(1);
});

test('when "people you know first" can\'t be reloaded, held replies stay held to try again', async () => {
	preferState.threadReplySort = 'relationship';
	const childrenOf: Record<string, Misskey.entities.Note[]> = { root: [note('r1')] };
	const t = renderThread(childrenOf);
	await t.root.load();
	t.seeReplies();
	t.backfilling.value = true;
	await t.root.add(announce('r2'));

	mocks.api.mockRejectedValueOnce(new Error('offline'));
	await expect(t.thread.showAllPending()).rejects.toThrow();
	expect(ids(t.root.replies.value)).toEqual(['r1']);
	expect(t.thread.pendingCount.value).toBe(1);

	childrenOf.root = [note('r2'), note('r1')];
	await t.thread.showAllPending();
	expect(ids(t.root.replies.value)).toEqual(['r2', 'r1']);
	expect(t.thread.pendingCount.value).toBe(0);
});

test('a shown reply stays listed even when it falls outside the replies the server returns', async () => {
	preferState.threadReplySort = 'relationship';
	const t = renderThread({ root: [note('r2'), note('r1')] });
	await t.root.load();
	t.seeReplies();
	t.backfilling.value = true;
	await t.root.add(announce('r0'));

	await t.thread.showAllPending();

	expect(ids(t.root.replies.value)).toEqual(['r2', 'r1', 'r0']);
	expect(t.thread.pendingCount.value).toBe(0);
});

test('a held reply deleted before it is shown never appears', async () => {
	const t = renderThread({ root: [note('r1')] });
	await t.root.load();
	t.seeReplies();
	t.backfilling.value = true;
	await t.root.add(announce('r2'));

	stream.noteUpdated({ id: 'r2', type: 'deleted', body: { deletedAt: '2026-01-01T00:00:01.000Z' } });
	await t.thread.showAllPending();

	expect(ids(t.root.replies.value)).toEqual(['r1']);
	expect(t.thread.pendingCount.value).toBe(0);
});

test('a held reply edited before it is shown appears as edited', async () => {
	const slowReplies: Record<string, Promise<Misskey.entities.Note>> = {};
	const t = renderThread({ root: [note('r1')] }, slowReplies);
	await t.root.load();
	t.seeReplies();
	t.backfilling.value = true;
	await t.root.add(announce('r2'));

	slowReplies.r2 = Promise.resolve({ ...note('r2'), text: 'edited' });
	stream.noteUpdated({ id: 'r2', type: 'updated', body: {} });
	await t.thread.showAllPending();

	expect(t.root.replies.value.find(reply => reply.id === 'r2')?.text).toBe('edited');
});

test('a held reply that can no longer be seen is dropped when shown', async () => {
	const slowReplies: Record<string, Promise<Misskey.entities.Note>> = {};
	const t = renderThread({ root: [note('r1')] }, slowReplies);
	await t.root.load();
	t.seeReplies();
	t.backfilling.value = true;
	await t.root.add(announce('r2'));

	slowReplies.r2 = Promise.reject(Object.assign(new Error('No such note.'), { code: 'NO_SUCH_NOTE' }));
	slowReplies.r2.catch(() => {});
	stream.noteUpdated({ id: 'r2', type: 'updated', body: {} });
	await t.thread.showAllPending();

	expect(ids(t.root.replies.value)).toEqual(['r1']);
	expect(t.thread.pendingCount.value).toBe(0);
});
