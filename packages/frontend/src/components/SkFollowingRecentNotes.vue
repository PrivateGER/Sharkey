<!--
SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkPullToRefresh :refresher="() => reload()">
	<MkPagination ref="latestNotesPaging" :pagination="latestNotesPagination" @init="onListReady">
		<template #empty>
			<div class="_fullinfo">
				<img :src="infoImageUrl" class="_ghost" :alt="i18n.ts.noNotes" aria-hidden="true"/>
				<div>{{ i18n.ts.noNotes }}</div>
			</div>
		</template>

		<template #default="{ items: notes }">
			<MkDateSeparatedList v-slot="{ item: note }" :items="notes" :class="$style.panel" :noGap="true">
				<SkFollowingFeedEntry v-if="!isHardMuted(note)" :isMuted="isSoftMuted(note)" :note="note" :class="props.selectedUserId == note.userId && $style.selected" @select="u => selectUser(u.id)"/>
			</MkDateSeparatedList>
		</template>
	</MkPagination>
</MkPullToRefresh>
</template>

<script setup lang="ts">
import * as Misskey from 'misskey-js';
import { computed, shallowRef } from 'vue';
import { infoImageUrl } from '@/instance.js';
import { i18n } from '@/i18n.js';
import MkDateSeparatedList from '@/components/MkDateSeparatedList.vue';
import MkPagination, { Paging } from '@/components/MkPagination.vue';
import SkFollowingFeedEntry from '@/components/SkFollowingFeedEntry.vue';
import { $i } from '@/account.js';
import { checkWordMute } from '@/scripts/check-word-mute.js';
import { FollowingFeedTab } from '@/scripts/following-feed-utils.js';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';

const props = defineProps<{
	userList: FollowingFeedTab;
	withNonPublic: boolean;
	withQuotes: boolean;
	withReplies: boolean;
	withBots: boolean;
	onlyFiles: boolean;
	selectedUserId?: string | null;
}>();

const emit = defineEmits<{
	(event: 'loaded', initialUserId?: string): void;
	(event: 'userSelected', userId: string): void;
}>();

defineExpose({ reload });

async function reload() {
	await latestNotesPaging.value?.reload();
}

function selectUser(userId: string) {
	emit('userSelected', userId);
}

async function onListReady(): Promise<void> {
	// This looks complicated, but it's really just a trick to get the first user ID from the pagination.
	const initialUserId = latestNotesPaging.value?.items.size
		? latestNotesPaging.value.items.values().next().value?.userId
		: undefined;

	emit('loaded', initialUserId);
}

const latestNotesPagination: Paging<'notes/following'> = {
	endpoint: 'notes/following' as const,
	limit: 20,
	params: computed(() => ({
		list: props.userList,
		filesOnly: props.onlyFiles,
		includeNonPublic: props.withNonPublic,
		includeReplies: props.withReplies,
		includeQuotes: props.withQuotes,
		includeBots: props.withBots,
	})),
};

const latestNotesPaging = shallowRef<InstanceType<typeof MkPagination>>();

function isSoftMuted(note: Misskey.entities.Note): boolean {
	return isMuted(note, $i?.mutedWords);
}

function isHardMuted(note: Misskey.entities.Note): boolean {
	return isMuted(note, $i?.hardMutedWords);
}

// Match the typing used by Misskey
type Mutes = (string | string[])[] | null | undefined;

// Adapted from MkNote.ts
function isMuted(note: Misskey.entities.Note, mutes: Mutes): boolean {
	return checkMute(note, mutes)
		|| checkMute(note.reply, mutes)
		|| checkMute(note.renote, mutes);
}

// Adapted from check-word-mute.ts
function checkMute(note: Misskey.entities.Note | undefined | null, mutes: Mutes): boolean {
	if (!note) {
		return false;
	}

	if (!mutes || mutes.length < 1) {
		return false;
	}

	return checkWordMute(note, $i, mutes);
}
</script>

<style module lang="scss">
.panel {
	background: var(--panel);
}

@keyframes border {
	from {
		border-left: 0 solid var(--accent);
	}
	to {
		border-left: 6px solid var(--accent);
	}
}

.selected {
	animation: border 0.2s ease-out 0s 1 forwards;

	&:first-child {
		border-top-left-radius: 5px;
	}

	&:last-child {
		border-bottom-left-radius: 5px;
	}
}
</style>
