/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, onUnmounted, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import type { MenuItem } from '@/types/menu.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { insertReply } from '@/utility/insert-reply.js';

// Replies often stream in bursts, e.g. from a backfill, so reload at most this often.
const reloadDelay = 1000;

/**
 * Lists a note's direct replies in the order set by the threadReplySort preference,
 * and keeps that order when replies stream in or the preference changes.
 */
export function useNoteReplies(note: Readonly<Ref<Misskey.entities.Note>>, limit: number) {
	const replies = ref<Misskey.entities.Note[]>([]);
	const loaded = ref(false);
	// Includes replies waiting for a reload, which aren't listed yet but must not be counted twice.
	const announced = new Set<Misskey.entities.Note['id']>();
	let latestLoad = 0;
	let reloadTimer: number | null = null;

	async function load(autoBackfill = false) {
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
		if (loadId === latestLoad) replies.value = res;
	}

	/**
	 * @returns false if the reply was already known, e.g. because it was announced twice
	 */
	function add(reply: Misskey.entities.Note): boolean {
		if (announced.has(reply.id)) return false;
		announced.add(reply.id);

		if (prefer.s.threadReplySort === 'newest') return insertReply(replies.value, reply);

		// Where the reply belongs depends on whether the viewer follows its author, which only the server knows.
		if (replies.value.some(existing => existing.id === reply.id)) return false;
		reloadTimer ??= window.setTimeout(() => {
			reloadTimer = null;
			load();
		}, reloadDelay);
		return true;
	}

	/**
	 * @returns false if the reply wasn't listed
	 */
	function remove(id: Misskey.entities.Note['id']): boolean {
		const index = replies.value.findIndex(reply => reply.id === id);
		if (index === -1) return false;
		replies.value.splice(index, 1);
		return true;
	}

	watch(prefer.r.threadReplySort, () => {
		if (loaded.value) load();
	});

	onUnmounted(() => {
		if (reloadTimer != null) window.clearTimeout(reloadTimer);
	});

	return { replies, loaded, load, add, remove };
}

export const threadReplySortLabel = computed(() => i18n.ts._threadReplySort[prefer.r.threadReplySort.value]);

export function showThreadReplySortMenu(anchor: EventTarget | null) {
	const options: MenuItem[] = (['newest', 'relationship'] as const).map(sort => ({
		type: 'radioOption',
		text: i18n.ts._threadReplySort[sort],
		caption: sort === 'relationship' ? i18n.ts._threadReplySort.relationshipDescription : undefined,
		active: computed(() => prefer.r.threadReplySort.value === sort),
		action: () => prefer.commit('threadReplySort', sort),
	}));
	os.popupMenu(options, anchor);
}
