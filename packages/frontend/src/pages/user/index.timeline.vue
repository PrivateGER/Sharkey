<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<template #header>
		<MkTab v-model="tab" :class="$style.tab">
			<option value="pinned">{{ i18n.ts.pinnedOnly }}</option>
			<option value="featured">{{ i18n.ts.featured }}</option>
			<option :value="null">{{ i18n.ts.notes }}</option>
			<option value="all">{{ i18n.ts.all }}</option>
			<option value="files">{{ i18n.ts.withFiles }}</option>
		</MkTab>
	</template>
	<div v-if="tab === 'pinned'" class="_gaps">
		<div v-if="user.pinnedNotes.length < 1" class="_fullinfo">
			<MkResult type="empty" :text="i18n.ts.noNotes"/>
		</div>
		<div v-else class="_panel">
			<DynamicNote v-for="note of user.pinnedNotes" :key="note.id" class="note" :class="$style.pinnedNote" :note="note" :pinned="true"/>
		</div>
	</div>
	<MkNotes v-else :noGap="true" :pagination="pagination" :class="$style.tl"/>
</MkStickyContainer>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import * as Misskey from 'misskey-js';
import MkNotes from '@/components/MkNotes.vue';
import MkTab from '@/components/MkTab.vue';
import { i18n } from '@/i18n.js';
import DynamicNote from '@/components/DynamicNote.vue';

const props = defineProps<{
	user: Misskey.entities.UserDetailed;
}>();

const tab = ref<string | null>('all');

const pagination = computed(() => tab.value === 'featured' ? {
	endpoint: 'users/featured-notes' as const,
	limit: 10,
	params: {
		userId: props.user.id,
	},
} : {
	endpoint: 'users/notes' as const,
	limit: 10,
	params: {
		userId: props.user.id,
		withRenotes: tab.value === 'all',
		withReplies: tab.value === 'all',
		withChannelNotes: tab.value === 'all',
		withFiles: tab.value === 'files',
	},
});
</script>

<style lang="scss" module>
.tab {
	padding: calc(var(--MI-margin) / 2) 0;
	background: var(--MI_THEME-bg);
}

.tl {
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	overflow: clip;
}
</style>
