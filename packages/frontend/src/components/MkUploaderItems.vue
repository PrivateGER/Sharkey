<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" class="_gaps_s">
	<div
		v-for="displayItem in displayItems"
		:key="displayItem.item.id"
		v-panel
		:class="[$style.item, { [$style.itemWaiting]: displayItem.item.preprocessing, [$style.itemCompleted]: displayItem.item.uploaded, [$style.itemFailed]: displayItem.item.uploadFailed }]"
		:style="{
			'--p': displayItem.item.progress != null ? `${displayItem.item.progress.value / displayItem.item.progress.max * 100}%` : '0%',
			'--pp': displayItem.item.preprocessProgress != null ? `${displayItem.item.preprocessProgress * 100}%` : '100%',
		}"
		@contextmenu.prevent.stop="onContextmenu(displayItem.item, $event)"
	>
		<div :class="$style.itemInner">
			<div :class="$style.itemActionWrapper">
				<MkButton :iconOnly="true" rounded @click="emit('showMenu', displayItem.item, $event)"><i class="ti ti-dots"></i></MkButton>
			</div>
			<div v-if="displayItem.item.thumbnail" :class="$style.itemThumbnail" :style="{ backgroundImage: `url(${ displayItem.item.thumbnail })` }"></div>
			<div v-else-if="displayItem.item.file.type.startsWith('video/')" :class="$style.itemThumbnail">
				<!-- the fragment makes browsers show the first frame instead of a blank box -->
				<video :src="`${displayItem.item.objectUrl}#t=0.1`" :class="$style.itemVideoThumbnail" preload="metadata" muted playsinline disablepictureinpicture></video>
			</div>
			<div v-else :class="[$style.itemThumbnail, $style.itemIconThumbnail]"><i class="ti ti-file"></i></div>
			<div :class="$style.itemBody">
				<div>
					<i v-if="displayItem.item.isSensitive" style="color: var(--MI_THEME-warn); margin-right: 0.5em;" class="ti ti-eye-exclamation"></i>
					<MkCondensedLine :minScale="2 / 3">
						<span>{{ displayItem.nameParts.baseName }}</span>
						<span v-if="displayItem.nameParts.extension != null" style="opacity: 0.5;">{{ displayItem.nameParts.extension }}</span>
					</MkCondensedLine>
				</div>
				<div :class="$style.itemInfo">
					<span>{{ displayItem.item.file.type }}</span>
					<span v-if="displayItem.item.compressedSize">({{ i18n.tsx._uploader.compressedToX({ x: bytes(displayItem.item.compressedSize) }) }} = {{ i18n.tsx._uploader.savedXPercent({ x: Math.round((1 - displayItem.item.compressedSize / displayItem.item.file.size) * 100) }) }})</span>
					<span v-else>{{ bytes(displayItem.item.file.size) }}</span>
					<span v-if="displayItem.item.compressionSkipped">({{ i18n.ts._uploader.compressionNotBeneficial }})</span>
					<span v-if="displayItem.item.preprocessing">{{ i18n.ts.preprocessing }}<MkLoading inline em style="margin-left: 0.5em;"/></span>
				</div>
				<button
					class="_button"
					:class="[$style.itemCaption, { [$style.itemCaptionSet]: getCaption(displayItem.item) != null }]"
					:disabled="displayItem.item.preprocessing || displayItem.item.uploading"
					@click="emit('editCaption', displayItem.item)"
				>
					<i class="ti ti-text-caption"></i>
					<span :class="$style.itemCaptionText">{{ getCaption(displayItem.item) ?? i18n.ts.describeFile }}</span>
				</button>
			</div>
			<div :class="$style.itemIconWrapper">
				<MkSystemIcon v-if="displayItem.item.uploading" :class="$style.itemIcon" type="waiting"/>
				<MkSystemIcon v-else-if="displayItem.item.uploaded" :class="$style.itemIcon" type="success"/>
				<MkSystemIcon v-else-if="displayItem.item.uploadFailed" :class="$style.itemIcon" type="error"/>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { isLink } from '@@/js/is-link.js';
import type { UploaderItem } from '@/use/use-uploader.js';
import { getUploadName } from '@/use/use-uploader.js';
import { i18n } from '@/i18n.js';
import MkButton from '@/components/MkButton.vue';
import bytes from '@/filters/bytes.js';

const props = defineProps<{
	items: UploaderItem[];
}>();

const displayItems = computed(() => props.items.map(item => ({
	item,
	nameParts: getUploadNameParts(item),
})));

const emit = defineEmits<{
	(ev: 'showMenu', item: UploaderItem, event: MouseEvent): void;
	(ev: 'showMenuViaContextmenu', item: UploaderItem, event: MouseEvent): void;
	(ev: 'editCaption', item: UploaderItem): void;
}>();

function getUploadNameParts(item: UploaderItem): {
	baseName: string;
	extension: string | null;
} {
	const name = getUploadName(item);
	const extensionIndex = name.lastIndexOf('.');

	if (extensionIndex === -1) {
		return {
			baseName: name,
			extension: null,
		};
	}

	return {
		baseName: name.substring(0, extensionIndex),
		extension: name.substring(extensionIndex),
	};
}

function getCaption(item: UploaderItem): string | null {
	return item.uploaded?.comment ?? item.caption ?? null;
}

function onContextmenu(item: UploaderItem, ev: MouseEvent) {
	if (ev.target && isLink(ev.target as HTMLElement)) return;
	if (window.getSelection()?.toString() !== '') return;

	emit('showMenuViaContextmenu', item, ev);
}
</script>

<style lang="scss" module>
.root {
	position: relative;
}

.item {
	position: relative;
	border-radius: 10px;
	overflow: clip;

	&::before {
		content: '';
		display: block;
		position: absolute;
		top: 0;
		left: 0;
		width: var(--p);
		height: 100%;
		background: color(from var(--MI_THEME-accent) srgb r g b / 0.5);
		transition: width 0.2s ease, left 0.2s ease;
	}

	&.itemWaiting {
		&::after {
			--c: color(from var(--MI_THEME-accent) srgb r g b / 0.25);

			content: '';
			display: block;
			position: absolute;
			top: 0;
			left: 0;
			width: var(--pp, 100%);
			height: 100%;
			background: linear-gradient(-45deg, transparent 25%, var(--c) 25%,var(--c) 50%, transparent 50%, transparent 75%, var(--c) 75%, var(--c));
			background-size: 25px 25px;
			animation: stripe .8s infinite linear;
		}
	}

	&.itemCompleted {
		&::before {
			left: 100%;
			width: var(--p);
		}

		.itemBody {
			color: var(--MI_THEME-accent);
		}
	}

	&.itemFailed {
		.itemBody {
			color: var(--MI_THEME-error);
		}
	}
}

@keyframes stripe {
	0% { background-position-x: 0; }
	100% { background-position-x: -25px; }
}

.itemInner {
	position: relative;
	z-index: 1;
	padding: 8px 16px;
	display: flex;
	align-items: center;
	gap: 12px;
}

.itemThumbnail {
	width: 70px;
	height: 70px;
	background-color: var(--MI_THEME-bg);
	background-size: contain;
	background-position: center;
	background-repeat: no-repeat;
	border-radius: 6px;
}

.itemBody {
	flex: 1;
	min-width: 0;
}

.itemVideoThumbnail {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
	border-radius: inherit;
	pointer-events: none;
}

.itemIconThumbnail {
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 28px;
	opacity: 0.7;
}

.itemCaption {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	max-width: 100%;
	margin-top: 6px;
	padding: 4px 10px;
	border-radius: 999px;
	background: var(--MI_THEME-buttonBg);
	font-size: 85%;

	&:hover:not(:disabled) {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&:disabled {
		opacity: 0.5;
	}

	&.itemCaptionSet {
		color: var(--MI_THEME-accent);
	}
}

.itemCaptionText {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.itemInfo {
	opacity: 0.7;
	margin-top: 4px;
	font-size: 90%;
	display: flex;
	gap: 8px;
}

.itemIcon {
	width: 35px;
}

@container (max-width: 500px) {
	.itemInner {
		flex-direction: column;
		gap: 8px;
	}

	.itemBody {
		font-size: 90%;
		text-align: center;
		width: 100%;
		min-width: 0;
	}

	.itemActionWrapper {
		position: absolute;
		top: 8px;
		left: 8px;
	}

	.itemInfo {
		justify-content: center;
	}

	.itemIconWrapper {
		position: absolute;
		top: 8px;
		right: 8px;
	}
}
</style>
