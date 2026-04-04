<!--
SPDX-FileCopyrightText: amelia and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div style="padding: 4px">
	<div class="flex">
		<a :href="data.musicbrainzUrl">
			<div class="imageContainer">
				<div v-if="shouldShowBars" class="musicBars">
					<div class="bar" :style="{ bottom: barPosition }"/>
					<div class="bar" :style="{ bottom: barPosition }"/>
					<div class="bar" :style="{ bottom: barPosition }"/>
				</div>
				<img v-if="data.coverArt" v-show="!loading" :src="data.coverArt" :alt="data.title" class="image" @load="loading = false"/>
				<MkLoading v-if="loading && data.coverArt" class="spinner"/>
			</div>
		</a>
		<div class="flex flex-col items-start titles">
			<p class="text-sm font-bold ellipsis">{{ data.title }}</p>
			<p class="text-xs font-medium ellipsis">{{ data.artist }}</p>
		</div>
		<a v-if="data.listenbrainzUrl" :href="data.listenbrainzUrl">
			<div class="playicon">
				<i class="ph-play ph-bold ph-lg"></i>
			</div>
		</a>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';

const props = defineProps<{
	data: {
		title: string,
		artist: string,
		coverArt: string | undefined,
		listenbrainzUrl: string | undefined,
		musicbrainzUrl: string | undefined,
	},
	popup?: boolean,
}>();

const loading = ref(true);

const shouldShowBars = computed(() => !props.data.coverArt || !loading.value);
const barPosition = props.data.coverArt ? '1px' : '1rem';
</script>

<style lang="scss" scoped>
.flex {
	display: flex;
	align-items: center;
}
.flex a {
  display: flex;
  align-items: center;
  text-decoration: none;
}
.imageContainer {
	position: relative;
	height: 3rem;
	width: 3rem;
	margin-right: 0.7rem;
}
.image {
	border-radius: 1em;
	height: 100%;
	width: 100%;
}
.spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.musicBars {
  position: absolute;
  left: 1px;
  top: 100%;
}
.bar {
	background: var(--MI_THEME-accent);
	border-radius: 0.25em;
  width: calc(0.8rem - 2px);
  position: absolute;
  animation: bars 0ms ease-in-out infinite alternate;
}
@keyframes bars {
	0% {
		height: 0.125em;
	}
	100% {
		height: 1rem;
	}
}
.bar:nth-child(1)  { left: 0.3rem; animation-duration: 342ms; animation-delay: -5312ms }
.bar:nth-child(2)  { left: 1.1rem; animation-duration: 303ms; animation-delay: -1392s }
.bar:nth-child(3)  { left: 1.9rem; animation-duration: 296ms; animation-delay: -357ms }
.items-start {
	align-items: flex-start;
}
.flex-col {
	display: flex;
	flex-direction: column;
}
.titles {
	flex-grow: 999;
	width: calc(100% - 6rem);
}
.text-sm {
	font-size: 0.75rem;
	margin: 0 0 0.3rem;
}
.font-bold {
	font-weight: 700;
}
.text-xs {
	font-size: 0.75rem;
	margin: 0;
}
.ellipsis {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  width: 100%
}
.font-medium {
	font-weight: 500;
}
.playicon {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 3rem;
	height: 3rem;
	font-size: 1.5rem;
}
@media (max-width: 500px) {
	.playicon {
		display: none;
	}
}
</style>
