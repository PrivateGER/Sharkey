<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="mkw-unixClock _monospace" :class="{ _panel: !widgetProps.transparent }" :style="{ fontSize: `${widgetProps.fontSize}em` }">
	<div v-if="widgetProps.showLabel" class="label">UNIX Epoch</div>
	<div class="time">
		<span v-text="ss"></span>
	</div>
	<div v-if="widgetProps.showLabel" class="label">UTC</div>
</div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useWidgetPropsManager } from './widget.js';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { GetFormResultType } from '@/utility/form.js';

const name = 'unixClock';

const widgetPropsDef = {
	transparent: {
		type: 'boolean' as const,
		default: false,
	},
	fontSize: {
		type: 'number' as const,
		default: 1.5,
		step: 0.1,
	},
	showLabel: {
		type: 'boolean' as const,
		default: true,
	},
};

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

let intervalId: number | null = null;
const ss = ref('');
const showColon = ref(false);
let prevSec: string | null = null;

watch(showColon, (v) => {
	if (v) {
		window.setTimeout(() => {
			showColon.value = false;
		}, 30);
	}
});

const tick = () => {
	const now = Date.now();
	ss.value = Math.floor(now / 1000).toString();
	if (ss.value !== prevSec) showColon.value = true;
	prevSec = ss.value;
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

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" scoped>
.mkw-unixClock {
	padding: 16px 0;
	text-align: center;

	> .label {
		font-size: 65%;
		opacity: 0.7;
	}

	> .time {
		> .colon {
			opacity: 0;
			transition: opacity 1s ease;

			&.showColon {
				opacity: 1;
				transition: opacity 0s;
			}
		}
	}
}
</style>
