<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span>
	<span v-text="hh"></span>
	<span :class="[$style.colon, { [$style.showColon]: showColon }]">:</span>
	<span v-text="mm"></span>
	<span v-if="showS" :class="[$style.colon, { [$style.showColon]: showColon }]">:</span>
	<span v-if="showS" v-text="ss"></span>
</span>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
	showS?: boolean;
	offset?: number;
	now?: () => Date;
}>(), {
	showS: true,
	offset: 0 - new Date().getTimezoneOffset(),
	now: () => new Date(),
});

let intervalId: number | null = null;
const hh = ref('');
const mm = ref('');
const ss = ref('');
const showColon = ref(false);
let prevSec: number | null = null;

watch(showColon, (v) => {
	if (v) {
		window.setTimeout(() => {
			showColon.value = false;
		}, 30);
	}
});

const tick = (): void => {
	const now = props.now();
	now.setMinutes(now.getMinutes() + now.getTimezoneOffset() + props.offset);
	hh.value = now.getHours().toString().padStart(2, '0');
	mm.value = now.getMinutes().toString().padStart(2, '0');
	ss.value = now.getSeconds().toString().padStart(2, '0');
	if (now.getSeconds() !== prevSec) showColon.value = true;
	prevSec = now.getSeconds();
};

tick();

onMounted(() => {
	if (intervalId) window.clearInterval(intervalId);
	intervalId = window.setInterval(tick, 1000);
});

onUnmounted(() => {
	if (intervalId !== null) {
		window.clearInterval(intervalId);
		intervalId = null;
	}
});
</script>

<style lang="scss" module>
.colon {
	opacity: 0;
	transition: opacity 1s ease;

	&.showColon {
		opacity: 1;
		transition: opacity 0s;
	}
}
</style>
