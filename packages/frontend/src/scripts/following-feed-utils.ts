/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, Ref, WritableComputedRef } from 'vue';
import { defaultStore } from '@/store.js';
import { deepMerge } from '@/scripts/merge.js';
import { PageHeaderItem } from '@/types/page-header.js';
import { i18n } from '@/i18n.js';
import { popupMenu } from '@/os.js';
import { MenuItem } from '@/types/menu.js';

export const followingTab = 'following' as const;
export const mutualsTab = 'mutuals' as const;
export const followersTab = 'followers' as const;
export const followingFeedTabs = [followingTab, mutualsTab, followersTab] as const;
export type FollowingFeedTab = typeof followingFeedTabs[number];

export function followingTabName(tab: FollowingFeedTab): string;
export function followingTabName(tab: FollowingFeedTab | null | undefined): null;
export function followingTabName(tab: FollowingFeedTab | null | undefined): string | null {
	if (tab === followingTab) return i18n.ts.following;
	if (tab === followersTab) return i18n.ts.followers;
	if (tab === mutualsTab) return i18n.ts.mutuals;
	return null;
}

export function followingTabIcon(tab: FollowingFeedTab | null | undefined): string {
	if (tab === followersTab) return 'ph-user ph-bold ph-lg';
	if (tab === mutualsTab) return 'ph-user-switch ph-bold ph-lg';
	return 'ph-user-check ph-bold ph-lg';
}

export type FollowingFeedModel = {
	[Key in keyof FollowingFeedState]: WritableComputedRef<FollowingFeedState[Key]>;
}

export interface FollowingFeedState {
	withNonPublic: boolean,
	withQuotes: boolean,
	withBots: boolean,
	withReplies: boolean,
	onlyFiles: boolean,
	userList: FollowingFeedTab,
	remoteWarningDismissed: boolean,
}

export const defaultFollowingFeedState: FollowingFeedState = {
	withNonPublic: false,
	withQuotes: false,
	withBots: true,
	withReplies: false,
	onlyFiles: false,
	userList: followingTab,
	remoteWarningDismissed: false,
};

interface StorageInterface<T extends Partial<FollowingFeedState> = Partial<FollowingFeedState>> {
	readonly state: Partial<T>;
	readonly reactiveState: Ref<Partial<T>>;
	save(updated: T): void;
}

export function createHeaderItem(storage?: Ref<StorageInterface>): PageHeaderItem {
	const menu = createOptionsMenu(storage);
	return {
		icon: 'ti ti-dots',
		text: i18n.ts.options,
		handler: ev => popupMenu(menu, ev.currentTarget ?? ev.target),
	};
}

export function createOptionsMenu(storage?: Ref<StorageInterface>): MenuItem[] {
	const {
		userList,
		withNonPublic,
		withQuotes,
		withBots,
		withReplies,
		onlyFiles,
	} = createModel(storage);

	return [
		{
			type: 'switch',
			text: i18n.ts.showNonPublicNotes,
			ref: withNonPublic,
			disabled: computed(() => userList.value === followersTab),
		},
		{
			type: 'switch',
			text: i18n.ts.showQuotes,
			ref: withQuotes,
		},
		{
			type: 'switch',
			text: i18n.ts.showBots,
			ref: withBots,
		},
		{
			type: 'switch',
			text: i18n.ts.showReplies,
			ref: withReplies,
			disabled: onlyFiles,
		},
		{
			type: 'divider',
		},
		{
			type: 'switch',
			text: i18n.ts.fileAttachedOnly,
			ref: onlyFiles,
			disabled: withReplies,
		},
	];
}

export function createModel(storage?: Ref<StorageInterface>): FollowingFeedModel {
	// eslint-disable-next-line no-param-reassign
	storage ??= createDefaultStorage();

	// Based on timeline.saveTlFilter()
	const saveFollowingFilter = <K extends keyof FollowingFeedState>(key: K, value: FollowingFeedState[K]) => {
		const state = deepMerge(storage.value.state, defaultFollowingFeedState);
		const out = deepMerge({ [key]: value }, state);
		storage.value.save(out);
	};

	const userList: WritableComputedRef<FollowingFeedTab> = computed({
		get: () => storage.value.reactiveState.value.userList ?? defaultFollowingFeedState.userList,
		set: value => saveFollowingFilter('userList', value),
	});
	const withNonPublic: WritableComputedRef<boolean> = computed({
		get: () => {
			if (userList.value === 'followers') return false;
			return storage.value.reactiveState.value.withNonPublic ?? defaultFollowingFeedState.withNonPublic;
		},
		set: value => saveFollowingFilter('withNonPublic', value),
	});
	const withQuotes: WritableComputedRef<boolean> = computed({
		get: () => storage.value.reactiveState.value.withQuotes ?? defaultFollowingFeedState.withQuotes,
		set: value => saveFollowingFilter('withQuotes', value),
	});
	const withBots: WritableComputedRef<boolean> = computed({
		get: () => storage.value.reactiveState.value.withBots ?? defaultFollowingFeedState.withBots,
		set: value => saveFollowingFilter('withBots', value),
	});
	const withReplies: WritableComputedRef<boolean> = computed({
		get: () => storage.value.reactiveState.value.withReplies ?? defaultFollowingFeedState.withReplies,
		set: value => saveFollowingFilter('withReplies', value),
	});
	const onlyFiles: WritableComputedRef<boolean> = computed({
		get: () => storage.value.reactiveState.value.onlyFiles ?? defaultFollowingFeedState.onlyFiles,
		set: value => saveFollowingFilter('onlyFiles', value),
	});
	const remoteWarningDismissed: WritableComputedRef<boolean> = computed({
		get: () => storage.value.reactiveState.value.remoteWarningDismissed ?? defaultFollowingFeedState.remoteWarningDismissed,
		set: value => saveFollowingFilter('remoteWarningDismissed', value),
	});

	return {
		userList,
		withNonPublic,
		withQuotes,
		withBots,
		withReplies,
		onlyFiles,
		remoteWarningDismissed,
	};
}

function createDefaultStorage() {
	return computed(() => ({
		state: defaultStore.state.followingFeed,
		reactiveState: defaultStore.reactiveState.followingFeed,
		save(updated: typeof defaultStore.state.followingFeed) {
			return defaultStore.set('followingFeed', updated);
		},
	}));
}
