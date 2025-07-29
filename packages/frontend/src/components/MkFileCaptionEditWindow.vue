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
	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<MkDriveFileThumbnail :file="file" fit="contain" style="height: 193px; margin-bottom: 16px;"/>
		<MkTextarea v-model="caption" autofocus :placeholder="i18n.ts.inputNewDescription" @keydown="onKeydown($event)">
			<template #label>{{ i18n.ts.caption }}</template>
		</MkTextarea>
		<div v-if="isImage">
			<MkSelect v-model="selectedModel" :style="{ marginTop: '16px' }">
				<template #label>{{ i18n.ts.altTextModel }}</template>
				<option value="fast">{{ i18n.ts.altTextModelFast }}</option>
				<option value="quality">{{ i18n.ts.altTextModelQuality }}</option>
				<option value="experimental">{{ i18n.ts.altTextModelExperimental }}</option>
			</MkSelect>
			<MkLoading v-if="loading" :style="{ marginTop: '16px' }"/>
			<MkButton :style="{ marginTop: '16px' }" :disabled="loading" @click="generateAltText">{{ i18n.ts.generateAltText }}</MkButton>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { useTemplateRef, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkDriveFileThumbnail from '@/components/MkDriveFileThumbnail.vue';
import { i18n } from '@/i18n.js';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{
	file: Misskey.entities.DriveFile;
	default: string;
}>();

const isImage = props.file.type.startsWith('image/');
let loading = ref(false);
const selectedModel = ref<'fast' | 'quality' | 'experimental'>('fast');

const emit = defineEmits<{
	(ev: 'done', v: string): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const caption = ref(props.default);

async function generateAltText() {
	if (!isImage) return;
	loading.value = true;

	try {
		const res = await misskeyApi('drive/files/generate-alt-text', {
			fileId: props.file.id,
			modelType: selectedModel.value,
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
