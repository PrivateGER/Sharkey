<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- Based on MkLazy.vue -->

<template>
<div ref="rootEl" :class="$style.root">
	<slot v-if="showing"></slot>
	<div v-else :class="$style.placeholder"></div>
</div>
</template>

<script lang="ts" setup>
import { nextTick, onMounted, onActivated, onBeforeUnmount, ref, shallowRef } from 'vue';

const rootEl = shallowRef<HTMLDivElement>();
const showing = ref(false);

defineExpose({ rootEl, showing });

const observer = new IntersectionObserver(entries =>
	showing.value = entries.some((entry) => entry.isIntersecting),
);

onMounted(() => {
	nextTick(() => {
		if (rootEl.value) {
			observer.observe(rootEl.value);
		}
	});
});

onActivated(() => {
	nextTick(() => {
		if (rootEl.value) {
			observer.observe(rootEl.value);
		}
	});
});

onBeforeUnmount(() => {
	observer.disconnect();
});
</script>

<style lang="scss" module>
.root {
	display: block;
}

.placeholder {
	display: block;
	min-height: 150px;
}
</style>
