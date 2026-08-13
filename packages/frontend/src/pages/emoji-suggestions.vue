<!--
SPDX-FileCopyrightText: Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps_m">
			<MkInfo>{{ i18n.ts.emojiSuggestionDescription }}</MkInfo>

			<MkFolder v-if="!canManageCustomEmojis">
				<template #icon><i class="ti ti-world-search"></i></template>
				<template #label>{{ i18n.ts.browseRemoteEmojis }}</template>
				<template #caption>{{ i18n.ts.browseRemoteEmojisDescription }}</template>
				<div class="_gaps">
					<MkInfo>{{ i18n.ts.remoteEmojiSuggestionDescription }}</MkInfo>
					<MkRemoteEmojiBrowser @select="emoji => addSuggestion(emoji)"/>
				</div>
			</MkFolder>

			<MkPagination ref="paginationComponent" :pagination="pagination" :displayLimit="50">
				<template #empty><MkResult type="empty" :text="i18n.ts.emojiSuggestionNoPending"/></template>
				<template #default="{ items }">
					<div class="_gaps_s">
						<article v-for="suggestion in (items as Misskey.entities.EmojiSuggestion[])" :key="suggestion.id" class="_panel" :class="$style.suggestion">
							<div :class="$style.preview">
								<img :src="suggestion.url" :alt="`:${suggestion.name}:`" :class="$style.image"/>
							</div>
							<div :class="$style.body">
								<div :class="$style.name">:{{ suggestion.name }}:</div>
								<div v-if="isModerator" :class="$style.proposer">
									<MkAvatar :user="suggestion.user" :class="$style.avatar" link preview/>
									<span>{{ i18n.ts.emojiSuggestionProposedBy }} <MkUserName :user="suggestion.user"/> <MkAcct :user="suggestion.user"/></span>
								</div>
								<div :class="$style.metadata">
									<span v-if="suggestion.category"><i class="ti ti-folder"></i> {{ suggestion.category }}</span>
									<span v-if="suggestion.aliases.length > 0"><i class="ti ti-tags"></i> {{ suggestion.aliases.join(', ') }}</span>
									<span v-if="suggestion.license"><i class="ti ti-license"></i> {{ suggestion.license }}</span>
									<span><MkTime :time="suggestion.createdAt" mode="detail"/></span>
								</div>
								<div :class="$style.flags">
									<span v-if="suggestion.isSensitive">{{ i18n.ts.sensitive }}</span>
									<span v-if="suggestion.localOnly">{{ i18n.ts.localOnly }}</span>
								</div>
								<div :class="$style.actions">
									<template v-if="isModerator">
										<MkButton primary inline @click="acceptSuggestion(suggestion)"><i class="ti ti-check"></i> {{ i18n.ts.accept }}</MkButton>
										<MkButton danger inline @click="rejectSuggestion(suggestion)"><i class="ti ti-x"></i> {{ i18n.ts.reject }}</MkButton>
									</template>
									<MkButton v-else danger inline @click="cancelSuggestion(suggestion)"><i class="ti ti-x"></i> {{ i18n.ts.cancel }}</MkButton>
								</div>
							</div>
						</article>
					</div>
				</template>
			</MkPagination>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkPagination, { type Paging } from '@/components/MkPagination.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkRemoteEmojiBrowser from '@/components/MkRemoteEmojiBrowser.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { definePage } from '@/page.js';

const paginationComponent = useTemplateRef<InstanceType<typeof MkPagination>>('paginationComponent');
const isModerator = $i?.isModerator === true || $i?.isAdmin === true;
const canManageCustomEmojis = isModerator || $i?.policies.canManageCustomEmojis === true;

const pagination = {
	endpoint: isModerator ? 'admin/emoji-suggestions/list' : 'emoji-suggestions/list',
	limit: 20,
} satisfies Paging<'admin/emoji-suggestions/list' | 'emoji-suggestions/list'>;

function addSuggestion(remoteEmoji?: Misskey.entities.EmojiDetailed) {
	const { dispose } = os.popup(defineAsyncComponent(() => import('@/pages/emoji-edit-dialog.vue')), {
		suggestion: true,
		remoteEmoji,
	}, {
		done: result => {
			if (result.suggested) paginationComponent.value?.prepend(result.suggested);
		},
		closed: () => dispose(),
	});
}

async function acceptSuggestion(suggestion: Misskey.entities.EmojiSuggestion) {
	const { canceled } = await os.confirm({
		type: 'question',
		text: i18n.tsx.emojiSuggestionConfirmAccept({ name: suggestion.name }),
	});
	if (canceled) return;

	await os.apiWithDialog('admin/emoji-suggestions/accept', { suggestionId: suggestion.id });
	paginationComponent.value?.removeItem(suggestion.id);
}

async function rejectSuggestion(suggestion: Misskey.entities.EmojiSuggestion) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx.emojiSuggestionConfirmReject({ name: suggestion.name }),
	});
	if (canceled) return;

	await os.apiWithDialog('admin/emoji-suggestions/reject', { suggestionId: suggestion.id });
	paginationComponent.value?.removeItem(suggestion.id);
}

async function cancelSuggestion(suggestion: Misskey.entities.EmojiSuggestion) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx.emojiSuggestionConfirmCancel({ name: suggestion.name }),
	});
	if (canceled) return;

	await os.apiWithDialog('emoji-suggestions/cancel', { suggestionId: suggestion.id });
	paginationComponent.value?.removeItem(suggestion.id);
}

const headerActions = computed(() => [{
	asFullButton: true,
	icon: 'ti ti-plus',
	text: i18n.ts.suggestEmoji,
	handler: () => addSuggestion(),
}]);

definePage(() => ({
	title: i18n.ts.emojiSuggestions,
	icon: 'ph-smiley-sticker ph-bold ph-lg',
}));
</script>

<style lang="scss" module>
.suggestion {
	display: flex;
	gap: 16px;
	padding: 16px;
}

.preview {
	display: grid;
	place-items: center;
	width: 96px;
	height: 96px;
	flex: 0 0 96px;
	border-radius: var(--MI-radius-sm);
	background: var(--MI_THEME-bg);
}

.image {
	max-width: 80px;
	max-height: 80px;
	object-fit: contain;
}

.body {
	min-width: 0;
	flex: 1;
}

.name {
	font-weight: 700;
	font-family: monospace;
	font-size: 1.15em;
}

.proposer {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 8px;
}

.avatar {
	width: 32px;
	height: 32px;
}

.metadata {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin-top: 8px;
	opacity: 0.8;
	overflow-wrap: anywhere;
}

.flags,
.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 12px;
}

.flags > span {
	padding: 2px 8px;
	border-radius: 999px;
	background: var(--MI_THEME-accentedBg);
}

@media (max-width: 500px) {
	.suggestion {
		flex-direction: column;
	}

	.preview {
		width: 100%;
	}
}
</style>
