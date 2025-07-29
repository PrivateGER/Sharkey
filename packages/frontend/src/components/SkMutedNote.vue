<!--
SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only

Displays a placeholder for a muted note.
-->

<template>
<I18n v-if="noteMuted" :src="i18n.ts.userSaysSomethingInMutedNote" tag="small">
	<template #name>
		<MkUserName :user="note.user"/>
	</template>
</I18n>
<I18n v-else-if="threadMuted" :src="i18n.ts.userSaysSomethingInMutedThread" tag="small">
	<template #name>
		<MkUserName :user="note.user"/>
	</template>
</I18n>

<br v-if="threadMuted && muted">

<template v-if="muted">
	<I18n v-if="muted === 'sensitiveMute'" :src="i18n.ts.userSaysSomethingSensitive" tag="small">
		<template #name>
			<MkUserName :user="note.user"/>
		</template>
	</I18n>
	<I18n v-else-if="!prefer.s.showSoftWordMutedWord" :src="i18n.ts.userSaysSomething" tag="small">
		<template #name>
			<MkUserName :user="note.user"/>
		</template>
	</I18n>
	<I18n v-else :src="i18n.ts.userSaysSomethingAbout" tag="small">
		<template #name>
			<MkUserName :user="note.user"/>
		</template>
		<template #word>
			{{ mutedWords }}
		</template>
	</I18n>
</template>
</template>

<script setup lang="ts">
import * as Misskey from 'misskey-js';
import { computed } from 'vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';

const props = withDefaults(defineProps<{
	muted: false | 'sensitiveMute' | string[];
	threadMuted?: boolean;
	noteMuted?: boolean;
	note: Misskey.entities.Note;
}>(), {
	threadMuted: false,
	noteMuted: false,
});

const mutedWords = computed(() => Array.isArray(props.muted)
	? props.muted.join(', ')
	: props.muted);
</script>

<style module lang="scss">

</style>
