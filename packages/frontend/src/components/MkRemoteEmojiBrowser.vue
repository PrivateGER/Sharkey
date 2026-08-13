<!--
SPDX-FileCopyrightText: Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
	<div>
		<FormSplit>
			<MkInput v-model="query" :debounce="true" type="search" autocapitalize="off">
				<template #prefix><i class="ti ti-search"></i></template>
				<template #label>{{ i18n.ts.search }}</template>
			</MkInput>
			<MkInput v-model="host" :debounce="true" type="search" autocapitalize="off">
				<template #label>{{ i18n.ts.host }}</template>
			</MkInput>
		</FormSplit>
		<MkPagination :pagination="pagination" :displayLimit="50">
			<template #empty><span>{{ i18n.ts.noCustomEmojis }}</span></template>
			<template #default="{ items }">
				<div :class="$style.emojis">
					<button
						v-for="emoji in (items as unknown as Misskey.entities.EmojiDetailed[])"
						:key="emoji.id"
						class="_panel _button"
						:class="$style.emoji"
						@click="emit('select', emoji, $event)"
					>
						<img :src="getProxiedImageUrl(emoji.url, 'emoji')" :class="$style.image" :alt="`:${emoji.name}:`"/>
						<div :class="$style.body">
							<div class="_monospace" :class="$style.name">{{ emoji.name }}</div>
							<div :class="$style.host">{{ emoji.host }}</div>
						</div>
					</button>
				</div>
			</template>
		</MkPagination>
	</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import * as Misskey from 'misskey-js';
import FormSplit from '@/components/form/split.vue';
import MkInput from '@/components/MkInput.vue';
import MkPagination, { type Paging } from '@/components/MkPagination.vue';
import { i18n } from '@/i18n.js';
import { getProxiedImageUrl } from '@/utility/media-proxy.js';

const emit = defineEmits<{
	(ev: 'select', emoji: Misskey.entities.EmojiDetailed, event: MouseEvent): void;
}>();

const props = withDefaults(defineProps<{
	endpoint?: 'emoji/list-remote' | 'admin/emoji/list-remote';
}>(), {
	endpoint: 'emoji/list-remote',
});

const query = ref<string | null>(null);
const host = ref<string | null>(null);

const pagination = {
	endpoint: props.endpoint,
	limit: 30,
	params: computed(() => ({
		query: query.value || null,
		host: host.value || null,
	})),
} satisfies Paging<'emoji/list-remote' | 'admin/emoji/list-remote'>;
</script>
<style lang="scss" module>
.emojis {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
	gap: 12px;
	margin: var(--MI-margin) 0;
}

.emoji {
	display: flex;
	align-items: center;
	padding: 12px;
	text-align: left;

	&:hover {
		color: var(--MI_THEME-accent);
	}
}

.image {
	width: 32px;
	height: 32px;
	object-fit: contain;
}

.body {
	padding-left: 8px;
	white-space: nowrap;
	overflow: hidden;
}

.name,
.host {
	text-overflow: ellipsis;
	overflow: hidden;
}

.host {
	opacity: 0.5;
	font-size: 90%;
}
</style>
