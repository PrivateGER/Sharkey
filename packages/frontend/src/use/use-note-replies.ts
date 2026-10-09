/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, inject, nextTick, onUnmounted, provide, ref, shallowReactive, watch } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import type { MenuItem } from '@/types/menu.js';
import * as os from '@/os.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { insertReply } from '@/utility/insert-reply.js';
import { useStream } from '@/stream.js';
import type { ReplyAnnouncement } from '@/use/use-note-capture.js';

// Replies often stream in bursts, e.g. from a backfill, so reload at most this often.
const reloadDelay = 1000;
const highlightDuration = 3000;
// Marks a reply right after it's shown; each reply component highlights it with the global-new-reply animation (style.scss).
export const newReplyClass = '_newReply';

type ReplyList = {
	pending: Readonly<Ref<Misskey.entities.Note[]>>;
	showPending: () => Promise<void>;
};

type ThreadReplies = {
	holding: Readonly<Ref<boolean>>;
	register: (list: ReplyList) => void;
	unregister: (list: ReplyList) => void;
};

const threadRepliesKey: InjectionKey<ThreadReplies> = Symbol('threadReplies');

/**
 * Lets every reply list in a thread hold back replies that arrive while the thread is being read,
 * because nested lists render inline before the replies that follow their parent,
 * so a reply placed anywhere in the thread moves everything below it.
 * Replies are held only during a backfill, and only once the replies have been on screen:
 * before that, nobody is reading them. Viewers who chose to see replies right away accept the movement.
 */
export function useThreadReplies(props: {
	backfilling: Readonly<Ref<boolean>>;
	listEl: Readonly<Ref<HTMLElement | null>>;
	headerEl: Readonly<Ref<HTMLElement | null>>;
}) {
	const listSeen = ref(false);
	const headerInView = ref(true);
	const observer = new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (entry.target === props.headerEl.value) headerInView.value = entry.isIntersecting;
			else if (entry.isIntersecting) listSeen.value = true;
		}
	});
	watch([props.listEl, props.headerEl], ([listEl, headerEl]) => {
		observer.disconnect();
		if (listEl) observer.observe(listEl);
		if (headerEl) observer.observe(headerEl);
	}, { immediate: true });

	const lists = shallowReactive(new Set<ReplyList>());
	const thread: ThreadReplies = {
		holding: computed(() => props.backfilling.value && listSeen.value && prefer.r.threadReplyArrival.value !== 'live'),
		register: list => {
			lists.add(list);
		},
		unregister: list => {
			lists.delete(list);
		},
	};
	provide(threadRepliesKey, thread);

	onUnmounted(() => observer.disconnect());

	// Every reply held anywhere in the thread, including replies to replies.
	const pending = computed(() => [...lists].flatMap(list => list.pending.value));

	return {
		thread,
		headerInView,
		pending,
		pendingCount: computed(() => pending.value.length),
		showAllPending: async () => {
			await Promise.all([...lists].map(list => list.showPending()));
			await nextTick();
			// Backfilled replies are often older than the ones on screen, so they can land far below where the reader is,
			// or just peek in at the bottom edge, where the highlight is easy to miss.
			const firstShown = props.listEl.value?.querySelector(`.${newReplyClass}`);
			const rect = firstShown?.getBoundingClientRect();
			if (firstShown && rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
				firstShown.scrollIntoView({ block: 'center', behavior: 'smooth' });
			}
		},
	};
}

/**
 * Lists a note's direct replies in the order set by the threadReplySort preference,
 * and keeps that order when replies stream in or the preference changes.
 * While the thread holds new replies, they wait in `pending` until `showPending` places them.
 */
export function useNoteReplies(note: Readonly<Ref<Misskey.entities.Note>>, limit: number, options: {
	thread?: ThreadReplies;
	// Holding replies back from an empty list would only show a count next to "no replies";
	// only safe for a list with nothing rendered below it.
	placeWhileEmpty?: boolean;
	// Removes a held reply that was deleted or can no longer be seen; defaults to `remove`.
	onHeldDeleted?: (id: Misskey.entities.Note['id']) => void;
} = {}) {
	const thread = options.thread ?? inject(threadRepliesKey, null);
	const connection = $i ? useStream() : null;
	const replies = ref<Misskey.entities.Note[]>([]);
	const pending = ref<Misskey.entities.Note[]>([]);
	const recentlyShown = ref<ReadonlySet<Misskey.entities.Note['id']>>(new Set());
	const loaded = ref(false);
	// Includes replies waiting for a reload, which aren't listed yet but must not be counted twice.
	const announced = new Set<Misskey.entities.Note['id']>();
	// Held replies the viewer asked to see, which stay held until a reload actually places them.
	const released = new Map<Misskey.entities.Note['id'], Misskey.entities.Note>();
	// Held replies that were edited, reacted to and so on since they were loaded.
	const changedWhileHeld = new Set<Misskey.entities.Note['id']>();
	let latestLoad = 0;
	let reloadTimer: number | null = null;
	let highlightTimer: number | null = null;

	/**
	 * @returns the released replies this load placed, or null if a later load superseded it
	 */
	async function load(autoBackfill = false): Promise<Misskey.entities.Note[] | null> {
		loaded.value = true;
		const loadId = ++latestLoad;
		const res = await misskeyApi('notes/children', {
			noteId: note.value.id,
			limit,
			showQuotes: false,
			sort: prefer.s.threadReplySort,
			autoBackfill,
		});
		// A load started later, e.g. for a different sort, wins even if it returns first.
		if (loadId !== latestLoad) return null;

		const placed = [...released.values()];
		released.clear();
		const placedIds = new Set(placed.map(reply => reply.id));
		pending.value = pending.value.filter(reply => !placedIds.has(reply.id));
		// Held replies stay held even when the server already returns them.
		const held = new Set(pending.value.map(reply => reply.id));
		const listed = res.filter(reply => !held.has(reply.id));
		// The server only returns the first `limit` replies, but one the viewer asked to see must not vanish.
		for (const reply of placed) {
			if (listed.some(existing => existing.id === reply.id)) continue;
			if (prefer.s.threadReplySort === 'newest') insertReply(listed, reply);
			else listed.push(reply);
		}
		replies.value = listed;
		return placed;
	}

	function shouldHold(userId: Misskey.entities.User['id']): boolean {
		if (!thread?.holding.value) return false;
		// The viewer expects to see their own reply right after posting it.
		if (userId === $i?.id) return false;
		return !(options.placeWhileEmpty && replies.value.length === 0);
	}

	/**
	 * Lists or holds a reply announced on the note's stream.
	 * @returns false if the reply was already known, e.g. because it was announced twice, or the viewer can't see it
	 */
	async function add(announcement: ReplyAnnouncement): Promise<boolean> {
		if (announced.has(announcement.id)) return false;
		announced.add(announcement.id);
		// Decided on arrival: a backfill's last replies often finish loading after it has ended, and placing them then would still move the thread.
		const hold = shouldHold(announcement.userId);

		let reply: Misskey.entities.Note;
		try {
			reply = await misskeyApi('notes/show', { noteId: announcement.id });
		} catch {
			return false;
		}
		if (replies.value.some(existing => existing.id === reply.id)) return false;

		if (hold) {
			pending.value.push(reply);
			return true;
		}

		if (prefer.s.threadReplySort === 'newest') return insertReply(replies.value, reply);

		// Where the reply belongs depends on whether the viewer follows its author, which only the server knows.
		reloadTimer ??= window.setTimeout(() => {
			reloadTimer = null;
			load();
		}, reloadDelay);
		return true;
	}

	/**
	 * @returns false if the reply wasn't listed or held
	 */
	function remove(id: Misskey.entities.Note['id']): boolean {
		released.delete(id);
		for (const list of [replies, pending]) {
			const index = list.value.findIndex(reply => reply.id === id);
			if (index !== -1) {
				list.value.splice(index, 1);
				return true;
			}
		}
		return false;
	}

	function highlight(shown: Misskey.entities.Note[]) {
		if (highlightTimer != null) window.clearTimeout(highlightTimer);
		recentlyShown.value = new Set(shown.map(reply => reply.id));
		highlightTimer = window.setTimeout(() => {
			highlightTimer = null;
			recentlyShown.value = new Set();
		}, highlightDuration);
	}

	/**
	 * Reloads held replies that changed while they waited, so that they aren't shown out of date, or at all once deleted.
	 * One that can't be reloaded, e.g. because of the endpoint's rate limit, stays marked as changed.
	 */
	async function refreshChanged() {
		const changed = pending.value.filter(reply => changedWhileHeld.has(reply.id));
		await Promise.all(changed.map(async reply => {
			let fresh: Misskey.entities.Note;
			try {
				fresh = await misskeyApi('notes/show', { noteId: reply.id });
			} catch (err) {
				if ((err as Misskey.api.APIError).code === 'NO_SUCH_NOTE') (options.onHeldDeleted ?? remove)(reply.id);
				return;
			}
			changedWhileHeld.delete(reply.id);
			const index = pending.value.findIndex(held => held.id === reply.id);
			if (index !== -1) pending.value[index] = fresh;
		}));
	}

	/**
	 * Held replies whose snapshot is current; one still marked as changed stays held, so that showing it again retries.
	 */
	function upToDatePending() {
		return pending.value.filter(reply => !changedWhileHeld.has(reply.id));
	}

	async function showPending() {
		if (pending.value.length === 0) return;
		await refreshChanged();
		const shown = upToDatePending();
		if (shown.length === 0) return;

		if (prefer.s.threadReplySort === 'newest') {
			const shownIds = new Set(shown.map(reply => reply.id));
			pending.value = pending.value.filter(reply => !shownIds.has(reply.id));
			for (const reply of shown) insertReply(replies.value, reply);
			highlight(shown);
			return;
		}

		// They stay held until the reload succeeds, so that a failed request leaves them to retry.
		// Replaces earlier releases, whose snapshots may have changed since.
		released.clear();
		for (const reply of shown) released.set(reply.id, reply);
		const placed = await load();
		if (placed != null) highlight(placed);
	}

	const list: ReplyList = { pending, showPending };
	thread?.register(list);

	// Held replies aren't rendered, so nothing else keeps them current while they wait.
	function onNoteUpdated(event: Misskey.NoteUpdatedEvent) {
		if (!pending.value.some(reply => reply.id === event.id)) return;
		if (event.type === 'deleted') (options.onHeldDeleted ?? remove)(event.id);
		else changedWhileHeld.add(event.id);
	}

	function onStreamConnected() {
		for (const reply of pending.value) connection?.send('s', { id: reply.id });
	}

	// After rendering, so that a reply leaving the held list is already subscribed by its own component;
	// the server counts subscriptions, and would otherwise briefly stop sending its events.
	watch(() => pending.value.map(reply => reply.id), (ids, oldIds) => {
		for (const id of ids) if (!oldIds.includes(id)) connection?.send('s', { id });
		for (const id of oldIds) {
			if (ids.includes(id)) continue;
			connection?.send('un', { id });
			changedWhileHeld.delete(id);
		}
	}, { flush: 'post' });

	connection?.on('noteUpdated', onNoteUpdated);
	connection?.on('_connected_', onStreamConnected);

	watch(prefer.r.threadReplySort, () => {
		if (!loaded.value) return;
		// Changing the order rebuilds the list anyway, so held replies take their places too.
		for (const reply of upToDatePending()) released.set(reply.id, reply);
		load();
	});

	onUnmounted(() => {
		thread?.unregister(list);
		connection?.off('noteUpdated', onNoteUpdated);
		connection?.off('_connected_', onStreamConnected);
		for (const reply of pending.value) connection?.send('un', { id: reply.id });
		if (reloadTimer != null) window.clearTimeout(reloadTimer);
		if (highlightTimer != null) window.clearTimeout(highlightTimer);
	});

	return { replies, pending, recentlyShown, loaded, load, add, remove, showPending };
}

export const threadReplySortLabel = computed(() => i18n.ts._threadReplySort[prefer.r.threadReplySort.value]);

export function showThreadReplySortMenu(anchor: EventTarget | null) {
	const sortOptions: MenuItem[] = (['newest', 'relationship'] as const).map(sort => ({
		type: 'radioOption',
		text: i18n.ts._threadReplySort[sort],
		caption: sort === 'relationship' ? i18n.ts._threadReplySort.relationshipDescription : undefined,
		active: computed(() => prefer.r.threadReplySort.value === sort),
		action: () => prefer.commit('threadReplySort', sort),
	}));
	const arrivalOptions: MenuItem[] = (['hold', 'append', 'live'] as const).map(arrival => ({
		type: 'radioOption',
		text: i18n.ts._threadReplyArrival[arrival],
		active: computed(() => prefer.r.threadReplyArrival.value === arrival),
		action: () => prefer.commit('threadReplyArrival', arrival),
	}));
	os.popupMenu([
		{ type: 'label', text: i18n.ts.threadReplySort },
		...sortOptions,
		{ type: 'divider' },
		{ type: 'label', text: i18n.ts.threadReplyArrival },
		...arrivalOptions,
	], anchor);
}
