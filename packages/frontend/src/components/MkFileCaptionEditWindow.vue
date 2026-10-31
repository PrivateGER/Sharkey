<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="800"
	:height="isNarrowScreen ? 720 : 560"
	:withOkButton="true"
	:okButtonDisabled="tooLong"
	@ok="ok()"
	@close="requestClose()"
	@esc="requestClose()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts.describeFile }}</template>
	<div :class="$style.root">
		<div v-if="previewSrc || file" :class="$style.previewPane">
			<img v-if="previewSrc" :src="previewSrc" alt="" :class="$style.preview"/>
			<MkDriveFileThumbnail v-else-if="file" :file="file" fit="contain" :class="$style.preview"/>
		</div>
		<div :class="$style.editorPane">
			<div v-if="isImage || isVideo" :class="$style.tools">
				<MkButton rounded small :disabled="status != null" :title="i18n.ts.generateAltText" @click="generateAltText('describe')"><i class="ph-sparkle ph-bold ph-lg"></i> {{ i18n.ts.altTextDescribe }}</MkButton>
				<MkButton v-if="isImage" rounded small :disabled="status != null" :title="i18n.ts.transcribeTextOnly" @click="generateAltText('ocr')"><i class="ph-scan ph-bold ph-lg"></i> {{ i18n.ts.altTextTextOnly }}</MkButton>
				<MkSelect v-if="isImage" v-model="selectedModel" small :disabled="status != null" :class="$style.model">
					<template #prefix><span :class="$style.modelLabel">{{ i18n.ts.altTextModel }}</span></template>
					<option value="fast">{{ i18n.ts.altTextModelFast }}</option>
					<option value="quality">{{ i18n.ts.altTextModelQuality }}</option>
					<option value="experimental">{{ i18n.ts.altTextModelExperimental }}</option>
				</MkSelect>
			</div>
			<!-- Shown next to the generate buttons, so it stays in view when the pane is short -->
			<div v-if="status" :class="$style.status">
				<MkLoading :inline="true" :em="true"/>
				<div :class="$style.statusText">
					<div>{{ statusText }}<span v-if="status.phase === 'generating'" :class="[$style.statusHint, $style.elapsed]" aria-hidden="true"> · {{ elapsedSeconds }}s</span></div>
					<div v-if="status.phase === 'generating'" :class="$style.statusHint">{{ i18n.tsx.altTextGenerationTakes({ seconds: expectedSeconds }) }}</div>
				</div>
				<button class="_textButton" :class="$style.cancel" @click="cancelGeneration()">{{ i18n.ts.cancel }}</button>
			</div>
			<MkInfo v-else-if="result" :warn="result.kind === 'error'" :closable="true" @close="result = null">{{ result.text }}</MkInfo>
			<MkButton v-if="previousCaption != null && status == null" rounded small :class="$style.restore" @click="restorePreviousCaption()">
				<i class="ph-arrow-counter-clockwise ph-bold ph-lg"></i> {{ i18n.ts.restorePreviousAltText }}
			</MkButton>
			<MkTextarea v-model="caption" :class="$style.textarea" :error="tooLong" autofocus :placeholder="i18n.ts.inputNewDescription" @keydown="onKeydown($event)">
				<template #label>{{ i18n.ts.caption }}</template>
				<template #caption>
					<span :class="[$style.counter, { [$style.tooLong]: tooLong }]">{{ caption.length }} / {{ instance.maxAltTextLength }}</span>
					<span v-if="tooLong" :class="$style.tooLong"> · {{ i18n.tsx.altTextOverLimit({ n: caption.length - instance.maxAltTextLength }) }}</span>
				</template>
			</MkTextarea>
			<!-- Live regions must exist before their content changes to be announced -->
			<div role="status" :class="$style.srOnly">{{ announcement }}</div>
			<div role="alert" :class="$style.srOnly">{{ alertText }}</div>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, nextTick, onUnmounted, useTemplateRef, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkDriveFileThumbnail from '@/components/MkDriveFileThumbnail.vue';
import MkInfo from '@/components/MkInfo.vue';
import { i18n } from '@/i18n.js';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import type { AltTextMode, GeneratedAltText } from '@/utility/posthog.js';
import { instance } from '@/instance.js';

type ModelType = 'fast' | 'quality' | 'experimental';

const props = defineProps<{
	file?: Misskey.entities.DriveFile | null;
	default?: string | null;
	/**
	 * Alt text can only be generated for files that are already in the drive.
	 * For a file that has not been uploaded yet, this is called to upload it before generating.
	 */
	prepareFile?: (() => Promise<Misskey.entities.DriveFile>) | null;
	/** MIME type of the file that prepareFile will upload */
	mimeType?: string | null;
	/** Image shown when there is no drive file yet */
	previewUrl?: string | null;
}>();

const emit = defineEmits<{
	(ev: 'done', v: string, generated: GeneratedAltText | null): void;
	(ev: 'closed'): void;
}>();

const fileType = props.file?.type ?? (props.prepareFile != null ? props.mimeType : null) ?? '';
const isImage = fileType.startsWith('image/');
const isVideo = fileType.startsWith('video/');
// The full image rather than its thumbnail, so transcribed text can be checked against it
const previewSrc = props.file ? (isImage ? props.file.url : props.file.thumbnailUrl) : props.previewUrl;
// Below this width the panes stack (see the container query) and need the extra height; 64px is the modal's padding
const isNarrowScreen = window.innerWidth < 640 + 64;

const dialog = useTemplateRef('dialog');

const initialCaption = props.default ?? '';
const caption = ref(initialCaption);
const tooLong = computed(() => caption.value.length > instance.maxAltTextLength);
const selectedModel = ref<ModelType>('fast');

const status = ref<{ phase: 'uploading' | 'generating'; mode: AltTextMode } | null>(null);
const elapsedSeconds = ref(0);
// p90 provider latency rounded up, from production $ai_generation events (Oct 2026): ~9s for images on
// fast/quality, ~16s for videos and for the experimental model. The model can't change mid-generation.
const expectedSeconds = computed(() => isVideo || selectedModel.value === 'experimental' ? 20 : 10);
const result = ref<{ kind: 'generated' | 'info' | 'error'; text: string } | null>(null);
/** The user's own text from before generations replaced it */
const previousCaption = ref<string | null>(null);
const alertText = ref('');

let generatedCaption: Omit<GeneratedAltText, 'edited'> & { text: string } | null = null;
let currentGeneration: AbortController | null = null;
let elapsedTimer: number | null = null;
let confirmingClose = false;

const statusText = computed(() => {
	if (status.value == null) return '';
	if (status.value.phase === 'uploading') return i18n.ts.uploading;
	if (status.value.mode === 'ocr') return i18n.ts.altTextStatusReadingText;
	return isVideo ? i18n.ts.altTextStatusDescribingVideo : i18n.ts.altTextStatusDescribingImage;
});

const announcement = computed(() => status.value != null ? statusText.value : result.value?.text ?? '');

watch(tooLong, value => {
	alertText.value = value ? i18n.ts.altTextTooLong : '';
});

function stopElapsedTimer() {
	if (elapsedTimer != null) window.clearInterval(elapsedTimer);
	elapsedTimer = null;
}

function setPhase(phase: 'uploading' | 'generating', mode: AltTextMode) {
	status.value = { phase, mode };
	stopElapsedTimer();
	elapsedSeconds.value = 0;
	if (phase === 'generating') {
		elapsedTimer = window.setInterval(() => elapsedSeconds.value++, 1000);
	}
}

function errorText(err: unknown): string {
	if (err != null && typeof err === 'object' && 'code' in err) {
		if (err.code === 'VIDEO_TOO_LONG') return i18n.ts.videoTooLong;
		if (err.code === 'RATE_LIMIT_EXCEEDED') {
			const resetSec = 'info' in err && err.info != null && typeof err.info === 'object' && 'resetSec' in err.info && typeof err.info.resetSec === 'number' ? err.info.resetSec : null;
			return resetSec != null
				? i18n.tsx.altTextRateLimited({ seconds: Math.max(1, Math.ceil(resetSec)) })
				: `${i18n.ts.rateLimitExceeded}. ${i18n.ts.tryAgain}`;
		}
	}
	return i18n.ts.failedToGenerateAltText;
}

async function generateAltText(mode: AltTextMode) {
	if ((!isImage && !isVideo) || currentGeneration != null) return;

	const generation = new AbortController();
	currentGeneration = generation;
	result.value = null;
	const modelType: ModelType = isVideo ? 'fast' : selectedModel.value;

	try {
		let file = props.file;
		if (file == null) {
			if (props.prepareFile == null) return;
			setPhase('uploading', mode);
			try {
				file = await props.prepareFile();
			} catch {
				if (!generation.signal.aborted) result.value = { kind: 'error', text: i18n.ts.altTextUploadFailed };
				return;
			}
			// The upload can't be aborted, so a cancelled generation only finds out here
			if (generation.signal.aborted) return;
		}

		setPhase('generating', mode);
		const res = await misskeyApi('drive/files/generate-alt-text', {
			fileId: file.id,
			modelType,
			mode,
		}, undefined, generation.signal);

		// Keep what the user already wrote rather than replacing it with nothing
		if (mode === 'ocr' && res.text.length === 0) {
			result.value = { kind: 'info', text: i18n.ts.noTextFoundInImage };
			return;
		}

		// Generated text the user hasn't changed isn't worth restoring; keep the draft from before it instead
		if (caption.value !== generatedCaption?.text && caption.value.trim().length > 0 && caption.value !== res.text) {
			previousCaption.value = caption.value;
		}
		caption.value = res.text;
		generatedCaption = { text: res.text, modelType, mode, fileId: file.id };
		result.value = { kind: 'generated', text: i18n.ts.generatedAltTextSuccess };
	} catch (err) {
		if (!generation.signal.aborted) result.value = { kind: 'error', text: errorText(err) };
	} finally {
		if (currentGeneration === generation) {
			currentGeneration = null;
			status.value = null;
			stopElapsedTimer();
		}
	}
}

function cancelGeneration() {
	currentGeneration?.abort();
	currentGeneration = null;
	status.value = null;
	stopElapsedTimer();
}

function restorePreviousCaption() {
	if (previousCaption.value == null) return;
	caption.value = previousCaption.value;
	previousCaption.value = null;
	generatedCaption = null;
	result.value = null;
}

async function requestClose() {
	if (confirmingClose) return;

	if (status.value != null || caption.value !== initialCaption) {
		confirmingClose = true;
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.ts.leaveConfirm,
		});
		confirmingClose = false;
		if (canceled) return;
	}

	cancelGeneration();
	dialog.value?.close();
}

function onKeydown(ev: KeyboardEvent) {
	if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) ok();

	// Global hotkeys are ignored while the textarea has focus
	if (ev.key === 'Escape') requestClose();
}

function ok() {
	if (tooLong.value) {
		// The ✓ button is disabled, but Ctrl+Enter still lands here; re-announce why nothing happens
		alertText.value = '';
		nextTick(() => alertText.value = i18n.ts.altTextTooLong);
		return;
	}
	cancelGeneration();
	const generated: GeneratedAltText | null = generatedCaption && {
		edited: caption.value !== generatedCaption.text,
		modelType: generatedCaption.modelType,
		mode: generatedCaption.mode,
		fileId: generatedCaption.fileId,
	};
	generatedCaption = null;
	emit('done', caption.value, generated);
	dialog.value?.close();
}

onUnmounted(() => {
	cancelGeneration();
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: 16px;
	box-sizing: border-box;
	padding: 20px;

	@media (max-width: 500px) {
		padding: 16px;
	}
}

.previewPane {
	flex-shrink: 0;
	height: 193px;
	overflow: hidden;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
}

.preview {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
}

.editorPane {
	display: flex;
	flex-direction: column;
	gap: 16px;
	min-width: 0;
}

.tools {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.model {
	min-width: 120px;
}

.modelLabel {
	padding-left: 12px;
	font-size: 0.85em;
	font-weight: bold;
}

.counter {
	color: var(--MI_THEME-fg);
}

// Mixed toward the text color so it keeps enough contrast in light and dark themes
.tooLong {
	color: color-mix(in srgb, var(--MI_THEME-error) 70%, var(--MI_THEME-fg));
	font-weight: bold;
}

// The window body is a size container: side by side when there is room, stacked on narrow screens
@container (min-width: 640px) {
	.root {
		flex-direction: row;
		height: 100%;
	}

	.previewPane {
		flex: 1;
		height: auto;
	}

	.editorPane {
		flex: 1;
		overflow: auto;
	}
}

// Short windows (e.g. landscape phones): let the textarea give up height before the status and counter scroll away
@container (max-height: 360px) {
	.root {
		padding-top: 12px;
		padding-bottom: 12px;
	}

	.editorPane {
		gap: 10px;
	}

	.textarea :global(textarea) {
		min-height: 4.5em;
	}
}

.status {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px 14px;
	font-size: 90%;
	border-radius: var(--MI-radius);
	background: color-mix(in srgb, var(--MI_THEME-accent) 8%, transparent);
}

.statusText {
	flex: 1;
	min-width: 0;
}

.statusHint {
	font-size: 90%;
}

.elapsed {
	white-space: nowrap;
}

.cancel {
	color: var(--MI_THEME-fg);
	font-weight: bold;
	text-decoration: underline;
}

.restore {
	align-self: flex-start;
}

.srOnly {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
</style>
