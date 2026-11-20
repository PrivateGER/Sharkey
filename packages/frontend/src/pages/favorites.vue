<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions">
	<div ref="rootEl" class="_spacer _gaps" style="--MI_SPACER-w: 800px;">
		<MkInput v-model="search" type="search" :placeholder="i18n.ts._favorites.searchPlaceholder" debounce>
			<template #prefix><i class="ti ti-search"></i></template>
		</MkInput>

		<!-- Unlike a timeline this list doesn't need capping, so MkPagination's trim-to-displayLimit whenever the top is
		     visible would only throw away scrollback (including a restored snapshot, which mounts at the top). -->
		<MkPagination ref="paginationEl" :pagination="pagination" :initialState="restored?.list ?? undefined" :displayLimit="Infinity">
			<template #empty><MkResult type="empty" :text="filtersActive ? i18n.ts._favorites.noMatches : i18n.ts._favorites.empty"/></template>

			<template #default="{ items }">
				<SkDateSeparatedList v-slot="{ item }" :items="items">
					<DynamicNote :key="item.id" :note="item.note" :class="$style.note" :data-scroll-anchor="item.id"/>
				</SkDateSeparatedList>
			</template>
		</MkPagination>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import { getScrollContainer } from '@@/js/scroll.js';
import type { Paging } from '@/components/MkPagination.vue';
import type { MisskeyEntity } from '@/types/date-separated-list.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkPagination from '@/components/MkPagination.vue';
import DynamicNote from '@/components/DynamicNote.vue';
import SkDateSeparatedList from '@/components/SkDateSeparatedList.vue';
import MkInput from '@/components/MkInput.vue';
import * as os from '@/os.js';
import { globalEvents } from '@/events.js';
import { i18n } from '@/i18n.js';
import { defaultMemoryStorage } from '@/memory-storage.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';

type Snapshot = {
	search: string;
	withFiles: boolean;
	user: Misskey.entities.UserDetailed | null;
	/** Null when nothing had loaded yet (request pending or failed), so the next visit fetches normally. */
	list: { items: MisskeyEntity[]; more: boolean; } | null;
	/** Favorite nearest the middle of the viewport, and its distance from the top of the scroll container. */
	anchor: { id: string; offset: number; } | null;
};

// Lets a deep scroll position survive the page being evicted from the router's page cache.
// Memory storage is gone after a reload, account switch or logout, so a reload starts fresh.
const SNAPSHOT_KEY = 'favorites-page';
const restored = defaultMemoryStorage.getItem<Snapshot>(SNAPSHOT_KEY);

const search = ref(restored?.search ?? '');
const withFiles = ref(restored?.withFiles ?? false);
const user = shallowRef<Misskey.entities.UserDetailed | null>(restored?.user ?? null);

const filtersActive = computed(() => search.value.trim() !== '' || withFiles.value || user.value != null);

const params = computed(() => ({
	query: search.value.trim() || undefined,
	withFiles: withFiles.value,
	userId: user.value?.id,
}));

const pagination: Paging<'i/favorites'> = {
	endpoint: 'i/favorites',
	limit: 10,
	params,
};

const rootEl = useTemplateRef('rootEl');
const paginationEl = useTemplateRef('paginationEl');
const router = useRouter();
const ownPath = router.getCurrentFullPath();

function findAnchor(): Snapshot['anchor'] {
	const container = getScrollContainer(rootEl.value);
	if (!container || !rootEl.value) return null;
	const containerTop = container.getBoundingClientRect().top;
	const middle = containerTop + container.clientHeight / 2;
	// Nearest note rather than the one spanning the middle: the middle can fall in a gap or date divider.
	let best: { id: string; offset: number; distance: number; } | null = null;
	for (const el of rootEl.value.querySelectorAll<HTMLElement>('[data-scroll-anchor]')) {
		const id = el.dataset.scrollAnchor;
		if (!id) continue;
		const rect = el.getBoundingClientRect();
		const distance = rect.top > middle ? rect.top - middle : rect.bottom < middle ? middle - rect.bottom : 0;
		if (best == null || distance < best.distance) best = { id, offset: rect.top - containerTop, distance };
		if (distance === 0) break;
	}
	return best && { id: best.id, offset: best.offset };
}

// The router emits before the next page renders, so the list is still laid out here; by the time the page is
// deactivated or unmounted its DOM is detached and can't be measured. Matching on the path we're leaving (rather
// than tracking activation) also covers router views that mount pages without KeepAlive.
router.useListener('change', ({ beforeFullPath }) => {
	if (beforeFullPath !== ownPath || !paginationEl.value) return;
	const items = Array.from(paginationEl.value.items.values());
	defaultMemoryStorage.setItem(SNAPSHOT_KEY, {
		search: search.value,
		withFiles: withFiles.value,
		user: user.value,
		list: items.length > 0 ? { items, more: paginationEl.value.more } : null,
		anchor: items.length > 0 ? findAnchor() : null,
	} satisfies Snapshot);
});

// Each note renders from its own copy, so toggling a favorite doesn't reach the list items. Keep them in
// sync so a restored snapshot doesn't offer "Remove from favorites" on a note that was already removed.
function onFavoriteChanged(noteId: string, favorited: boolean) {
	for (const item of paginationEl.value?.items.values() ?? []) {
		if (item.note.id === noteId) item.note.isFavorited = favorited;
	}
}

globalEvents.on('noteFavoriteChanged', onFavoriteChanged);
onBeforeUnmount(() => globalEvents.off('noteFavoriteChanged', onFavoriteChanged));

/**
 * Favorites added since the snapshot was taken sit above everything it holds, where loading more never reaches.
 * Feed them through prepend(), which holds them back while the user is scrolled down, so the restored
 * position doesn't move.
 */
async function loadNewerThan(newestId: string) {
	const known = new Set(Array.from(paginationEl.value?.items.values() ?? [], item => item.note.id));
	const limit = 100;
	let sinceId = newestId;
	for (;;) {
		// sinceId pages come back oldest first, so prepending one at a time leaves the newest on top.
		const res = await misskeyApi('i/favorites', { ...params.value, sinceId, limit });
		for (const favorite of res) {
			// Re-favoriting a note creates a new favorite; keep its existing entry instead of listing it twice.
			if (!known.has(favorite.note.id)) paginationEl.value?.prepend(favorite);
		}
		const last = res.at(-1);
		if (res.length < limit || !last) return;
		sinceId = last.id;
	}
}

function restoreAnchor(anchor: NonNullable<Snapshot['anchor']>) {
	const container = getScrollContainer(rootEl.value);
	if (!container) return;

	// Notes render asynchronously and change height as they lay out, so keep correcting for a short while.
	// Any user input ends it, so we never fight the user's own scrolling.
	let cancelled = false;
	const cancel = () => { cancelled = true; };
	const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
	for (const ev of inputEvents) container.addEventListener(ev, cancel, { passive: true, once: true });
	const deadline = performance.now() + 1000;

	const step = () => {
		if (cancelled || performance.now() > deadline) {
			for (const ev of inputEvents) container.removeEventListener(ev, cancel);
			return;
		}
		const el = rootEl.value?.querySelector(`[data-scroll-anchor="${anchor.id}"]`);
		if (el) {
			const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset;
			if (Math.abs(delta) >= 1) container.scrollTop += delta;
		}
		window.requestAnimationFrame(step);
	};
	step();
}

onMounted(() => {
	if (!restored?.list) return;
	const { list, anchor } = restored;
	if (anchor) nextTick(() => restoreAnchor(anchor));
	const newest = list.items[0];
	// Best effort: if this fails the restored list simply stays as it was.
	if (newest) loadNewerThan(newest.id).catch(() => {});
});

async function selectUser() {
	user.value = await os.selectUser({ includeSelf: true });
}

const headerActions = computed<PageHeaderItem[]>(() => [{
	icon: 'ti ti-dots',
	text: i18n.ts.options,
	highlighted: withFiles.value || user.value != null,
	handler: (ev) => {
		os.popupMenu([{
			type: 'switch',
			text: i18n.ts.fileAttachedOnly,
			ref: withFiles,
		}, { type: 'divider' }, {
			icon: 'ti ti-users',
			text: i18n.ts._favorites.anyUser,
			active: user.value == null,
			action: () => { user.value = null; },
		}, user.value ? {
			avatar: user.value,
			text: i18n.ts._favorites.byUser,
			caption: `@${Misskey.acct.toString(user.value)}`,
			active: true,
			action: selectUser,
		} : {
			icon: 'ti ti-user',
			text: i18n.ts._favorites.byUser,
			action: selectUser,
		}], ev.currentTarget ?? ev.target);
	},
}]);

definePage(() => ({
	title: i18n.ts.favorites,
	icon: 'ti ti-star',
}));
</script>

<style lang="scss" module>
.note {
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
}
</style>
