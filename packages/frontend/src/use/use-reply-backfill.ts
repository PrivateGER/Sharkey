/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onUnmounted, ref } from 'vue';
import type { Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import type { ReplyBackfillEvent } from '@/use/use-note-capture.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

// A worker can die without announcing the end; don't show "checking" forever.
const checkingTimeout = 1000 * 60 * 5;

type Outcome = { imported: number; failed: boolean };

/**
 * Tracks fetching a remote note's replies from its origin server, for both user requests and automatic checks.
 */
export function useReplyBackfill(note: Readonly<Ref<Misskey.entities.Note>>) {
	const checking = ref(false);
	const result = ref<Outcome | null>(null);

	let awaitedBackfillId: string | null = null;
	// Outcomes seen on the stream, in case one arrives before the request that started it has returned.
	const finished = new Map<string, Outcome>();
	let checkingTimer: number | null = null;

	function setChecking(value: boolean) {
		if (checkingTimer != null) window.clearTimeout(checkingTimer);
		checkingTimer = value ? window.setTimeout(() => setChecking(false), checkingTimeout) : null;
		checking.value = value;
		if (value) result.value = null;
	}

	function onEvent(event: ReplyBackfillEvent) {
		if (event.type === 'repliesBackfillStarted') {
			setChecking(true);
			return;
		}

		// A run that outlived its reservation can finish while the page is waiting on the next one.
		if (awaitedBackfillId == null || event.body.backfillId === awaitedBackfillId) setChecking(false);
		const outcome = { imported: event.body.imported, failed: event.body.failed };
		finished.set(event.body.backfillId, outcome);
		result.value = outcome;
		if (event.body.backfillId === awaitedBackfillId) awaitedBackfillId = null;
	}

	async function request() {
		let response: Misskey.entities.NotesRepliesBackfillResponse;
		try {
			response = await misskeyApi('notes/replies/backfill', { noteId: note.value.id });
		} catch (err) {
			os.alert({ type: 'error', text: (err as Misskey.api.APIError).message });
			return;
		}

		if (response.status === 'recentlyChecked' || response.backfillId == null) {
			os.toast(i18n.ts.remoteRepliesRecentlyChecked);
			return;
		}

		const outcome = finished.get(response.backfillId);
		if (outcome != null) {
			result.value = outcome;
			return;
		}

		awaitedBackfillId = response.backfillId;
		setChecking(true);
	}

	onUnmounted(() => {
		if (checkingTimer != null) window.clearTimeout(checkingTimer);
	});

	return { checking, result, request, onEvent };
}
