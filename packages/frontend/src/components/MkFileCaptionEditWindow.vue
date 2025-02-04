<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="400"
	:height="500"
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
		<div>
			<MkLoading v-if="loading" :style="{ marginTop: '16px' }" />
			<MkButton v-if="isImage" :style="{ marginTop: '16px' }" :disabled="loading" @click="generateAltText">{{ i18n.ts.generateAltText }}</MkButton>
		</div>
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
import {misskeyApi} from "@/scripts/misskey-api.js";

const props = defineProps<{
	file: Misskey.entities.DriveFile;
	default: string;
}>();

const isImage = props.file.type.startsWith('image/');
let loading = ref(false);

const emit = defineEmits<{
	(ev: 'done', v: string): void;
	(ev: 'closed'): void;
}>();

const dialog = shallowRef<InstanceType<typeof MkModalWindow>>();

const caption = ref(props.default);

async function generateAltText() {
	if (!isImage) return;
	loading.value = true;

	try {
		const res = await misskeyApi('drive/files/generate-alt-text', {
			fileId: props.file.id,
		});

		if (!res) {
			os.toast(i18n.ts.failedToGenerateAltText);
			return;
		}

		os.toast(i18n.ts.generatedAltTextSuccess);
		caption.value = res.text;
		// eslint-disable-next-line id-denylist
	} catch (e) {
		os.toast(i18n.ts.failedToGenerateAltText);
		return;
	} finally {
		loading.value = false;
	}
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
