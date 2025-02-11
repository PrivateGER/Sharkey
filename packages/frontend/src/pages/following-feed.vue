<!--
SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.header">
		<MkPageHeader v-model:tab="userList" :tabs="headerTabs" :actions="headerActions" :displayBackButton="true" @update:tab="onChangeTab"/>
		<SkRemoteFollowersWarning :class="$style.remoteWarning" :model="model"/>
	</div>

	<div ref="noteScroll" :class="$style.notes">
		<MkHorizontalSwipe v-model:tab="userList" :tabs="headerTabs">
			<SkFollowingRecentNotes ref="followingRecentNotes" :selectedUserId="selectedUserId" :userList="userList" :withNonPublic="withNonPublic" :withQuotes="withQuotes" :withBots="withBots" :withReplies="withReplies" :onlyFiles="onlyFiles" @userSelected="userSelected" @loaded="listReady"/>
		</MkHorizontalSwipe>
	</div>

	<SkLazy ref="userScroll" :class="$style.user">
		<MkHorizontalSwipe v-if="selectedUserId" v-model:tab="userList" :tabs="headerTabs">
			<SkUserRecentNotes ref="userRecentNotes" :userId="selectedUserId" :withNonPublic="withNonPublic" :withQuotes="withQuotes" :withBots="withBots" :withReplies="withReplies" :onlyFiles="onlyFiles"/>
		</MkHorizontalSwipe>
	</SkLazy>
</div>
</template>

<script lang="ts" setup>
import { computed, ComputedRef, Ref, ref, shallowRef } from 'vue';
import { getScrollContainer } from '@@/js/scroll.js';
import { definePageMetadata } from '@/scripts/page-metadata.js';
import { i18n } from '@/i18n.js';
import MkHorizontalSwipe from '@/components/MkHorizontalSwipe.vue';
import { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import { PageHeaderItem } from '@/types/page-header.js';
import { useRouter } from '@/router/supplier.js';
import MkPageHeader from '@/components/global/MkPageHeader.vue';
import SkUserRecentNotes from '@/components/SkUserRecentNotes.vue';
import { useScrollPositionManager } from '@/nirax.js';
import { createModel, createHeaderItem, followingFeedTabs, followingTabIcon, followingTabName, followingTab } from '@/scripts/following-feed-utils.js';
import SkLazy from '@/components/global/SkLazy.vue';
import SkFollowingRecentNotes from '@/components/SkFollowingRecentNotes.vue';
import SkRemoteFollowersWarning from '@/components/SkRemoteFollowersWarning.vue';

const model = createModel();
const {
	userList,
	withNonPublic,
	withQuotes,
	withBots,
	withReplies,
	onlyFiles,
} = model;

const router = useRouter();

const userRecentNotes = shallowRef<InstanceType<typeof SkUserRecentNotes>>();
const followingRecentNotes = shallowRef<InstanceType<typeof SkFollowingRecentNotes>>();
const userScroll = shallowRef<InstanceType<typeof SkLazy>>();
const noteScroll = shallowRef<HTMLElement>();

const selectedUserId: Ref<string | null> = ref(null);

function listReady(initialUserId?: string): void {
	if (initialUserId && !selectedUserId.value) {
		selectedUserId.value = initialUserId;
	}
}

function userSelected(userId: string): void {
	selectedUserId.value = userId;

	if (!userScroll.value?.showing) {
		router.push(`/following-feed/${userId}`);
	}
}

async function reload() {
	await Promise.all([
		followingRecentNotes.value?.reload(),
		userRecentNotes.value?.reload(),
	]);
}

async function onChangeTab(): Promise<void> {
	selectedUserId.value = null;
}

const headerActions: PageHeaderItem[] = [
	{
		icon: 'ti ti-refresh',
		text: i18n.ts.reload,
		handler: () => reload(),
	},
	createHeaderItem(),
];

const headerTabs: ComputedRef<Tab[]> = computed(() => followingFeedTabs.map(t => ({
	key: t,
	icon: followingTabIcon(t),
	title: followingTabName(t),
})));

useScrollPositionManager(() => getScrollContainer(userScroll.value?.rootEl ?? null), router);
useScrollPositionManager(() => getScrollContainer(noteScroll.value ?? null), router);
definePageMetadata(() => ({
	title: i18n.ts.following,
	icon: followingTabIcon(followingTab),
}));

</script>

<style lang="scss" module>
//This inspection complains about duplicate "height" properties, but this is needed because "dvh" units are not supported in all browsers.
//The earlier "vh" provide a "close enough" approximation for older browsers.
//noinspection CssOverwrittenProperties
.root {
	display: grid;
	grid-template-columns: min-content 1fr min-content;
	grid-template-rows: min-content 1fr;
	grid-template-areas:
		"header header header"
		"lm notes rm";
	gap: 12px;

	height: 100vh;
	height: 100dvh;

	// The universal layout inserts a "spacer" thing that causes a stray scroll bar.
	// We have to create fake "space" for it to "roll up" and back into the viewport, which removes the scrollbar.
	margin-bottom: calc(-1 * var(--MI-minBottomSpacing));

	// Some "just in case" backup properties.
	// These should not be needed, but help to maintain the layout if the above trick ever stops working.
	overflow: hidden;
	position: sticky;
	top: 0;
}

.header {
	grid-area: header;
}

.notes {
	grid-area: notes;
	overflow-y: auto;
}

.user {
	grid-area: user;
	overflow-y: auto;
}

.remoteWarning {
	margin: 12px 12px 0 12px;
}

.userInfo {
	margin-bottom: 12px;
}

@container (max-width: 749px) {
	.user {
		display: none;
	}
}

@container (min-width: 750px) {
	.root {
		grid-template-columns: min-content 4fr 6fr min-content;
		grid-template-rows: min-content 1fr;
		grid-template-areas:
			"header header header header"
			"lm notes user rm";
		gap: 24px;
	}

	.remoteWarning {
		margin: 24px 24px 0 24px;
	}

	.userInfo {
		margin-bottom: 24px;
	}
}
</style>
