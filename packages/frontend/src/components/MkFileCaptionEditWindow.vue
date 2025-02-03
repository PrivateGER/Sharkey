<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="400"
	:height="450"
	:withOkButton="true"
	:okButtonDisabled="false"
	@ok="ok()"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts.describeFile }}</template>
	<MkSpacer :marginMin="20" :marginMax="28">
		<MkDriveFileThumbnail :file="file" fit="contain" style="height: 193px; margin-bottom: 16px;"/>
		<MkTextarea v-model="caption" autofocus :placeholder="i18n.ts.inputNewDescription" @keydown="onKeydown($event)">
			<template #label>{{ i18n.ts.caption }}</template>
		</MkTextarea>
		<MkButton v-if="isImage" :style="{ marginTop: '16px' }" @click="generateAltText">{{ i18n.ts.generateAltText }}</MkButton>
	</MkSpacer>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { shallowRef, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkDriveFileThumbnail from '@/components/MkDriveFileThumbnail.vue';
import { i18n } from '@/i18n.js';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';

const props = defineProps<{
	file: Misskey.entities.DriveFile;
	default: string;
}>();

const isImage = props.file.type.startsWith('image/');

const emit = defineEmits<{
	(ev: 'done', v: string): void;
	(ev: 'closed'): void;
}>();

const dialog = shallowRef<InstanceType<typeof MkModalWindow>>();

const caption = ref(props.default);

async function generateAltText() {
	if (!isImage) return;

	const res = await fetch(`/api/drive/files/generate-alt-text`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			fileId: props.file.id,
		}),
	});

	if (!res.ok) {
		os.toast(i18n.ts.failedToGenerateAltText);
		return;
	}

	const altText = await res.text();
	os.toast(i18n.ts.generatedAltText);
	caption.value = altText;
}

function onKeydown(ev: KeyboardEvent) {
	if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) ok();

	if (ev.key === 'Escape') {
		emit('closed');
		dialog.value?.close();
	}
}

async function ok() {
	emit('done', caption.value);
	dialog.value?.close();
}
</script>
