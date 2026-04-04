<!--
SPDX-FileCopyrightText: amelia and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div style="padding: 4px">
	<div class="flex">
		<a :href="data.musicbrainzUrl">
			<div v-if="data.coverArt" class="imageContainer">
				<div v-if="!loading" class="musicBars">
					<div class="bar"/>
					<div class="bar"/>
					<div class="bar"/>
					<div class="bar"/>
				</div>
				<img v-show="!loading" :src="data.coverArt" :alt="data.title" class="image" @load="loading = false"/>
				<MkLoading v-if="loading" class="spinner"/>
			</div>
		</a>
		<div class="flex flex-col items-start titles">
			<p class="text-sm font-bold">{{ data.title }}</p>
			<p class="text-xs font-medium">{{ data.artist }}</p>
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
import { ref } from 'vue';

defineProps<{
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
 	bottom: 1px;
  width: calc(0.8rem - 2px);
  position: absolute;
  animation: bars 0ms linear infinite alternate;
}
@keyframes bars {
	0% {
		height: 0.125em;
	}
	100% {
		height: 1rem;
	}
}
.bar:nth-child(1)  { left: 0.3rem; animation-duration: 300ms; animation-delay: -300ms }
.bar:nth-child(2)  { left: 1.1rem; animation-duration: 303ms; animation-delay: -200ms }
.bar:nth-child(3)  { left: 1.9rem; animation-duration: 310ms; animation-delay: -500ms }
.items-start {
	align-items: flex-start;
}
.flex-col {
	display: flex;
	flex-direction: column;
}
.titles {
	flex-grow: 999;
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
