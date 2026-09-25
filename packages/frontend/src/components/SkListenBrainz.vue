<!--
SPDX-FileCopyrightText: amelia and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<Transition>
	<div v-if="data" style="padding: 4px">
		<div class="flex">
			<component
				:is="data.musicbrainzUrl ? 'a' : 'div'"
				:href="data.musicbrainzUrl" 
				@click.prevent="data.musicbrainzUrl && warningExternalWebsite(data.musicbrainzUrl)"
			>
				<div class="imageContainer">
					<div v-if="prefer.s.animation && shouldShowBars" class="musicBars">
						<div class="bar" :style="{ bottom: barPosition }"/>
						<div class="bar" :style="{ bottom: barPosition }"/>
						<div class="bar" :style="{ bottom: barPosition }"/>
					</div>
					<img v-if="showCoverArt" v-show="!loading" :src="getProxiedImageUrl(data.coverArt!)" :alt="data.title" class="image" @load="loading = false" @error="onCoverArtError"/>
					<MkLoading v-if="loading && showCoverArt" class="spinner"/>
				</div>
			</component>
			<div class="flex flex-col items-start titles">
				<p class="listening-to">{{ i18n.ts._profile.listeningTo }}</p>
				<p class="text-sm font-bold ellipsis">{{ data.title }}</p>
				<p class="text-xs font-medium ellipsis">{{ data.artist }}</p>
			</div>
			<a 
				v-if="data.listenbrainzUrl" 
				:href="data.listenbrainzUrl"
				@click.prevent="warningExternalWebsite(data.listenbrainzUrl)"
			>
				<div class="playicon">
					<i class="ph-play ph-bold ph-lg"></i>
				</div>
			</a>
		</div>
	</div>
</Transition>
</template>

<script lang="ts" setup>
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue';
import { misskeyApi } from '@/utility/misskey-api';
import { prefer } from '@/preferences.js';
import { i18n } from '@/i18n';
import { getProxiedImageUrl } from '@/utility/media-proxy';
import { warningExternalWebsite } from '@/utility/warning-external-website';

interface ListenBrainzData {
	title: string,
	artist: string,
	coverArt?: string,
	listenbrainzUrl?: string,
	musicbrainzUrl?: string,
}

const props = defineProps<{
	userId: string,
	popup?: boolean,
}>();

const data = ref<ListenBrainzData>();

const loading = ref(true);
// Cover Art Archive has no artwork for many releases, so the image can fail to load
const coverArtFailed = ref(false);

const showCoverArt = computed(() => !!data.value?.coverArt && !coverArtFailed.value);
const shouldShowBars = computed(() => !showCoverArt.value || !loading.value);
const barPosition = computed(() => showCoverArt.value ? '1px' : '1rem');

function onCoverArtError() {
	coverArtFailed.value = true;
	loading.value = false;
}

let intervalId: number;

watch(data, (newData, oldData) => {
	if (newData?.coverArt !== oldData?.coverArt) {
		coverArtFailed.value = false;
		if (!loading.value) loading.value = true;
	}
});

onMounted(() => {
	const fetchLB = async () => {
		try {
			await misskeyApi('users/listenbrainz', { userId: props.userId })
				.then((res: ListenBrainzData) => data.value = res);
		} catch (err) {
			console.error(`ListenBrainz failed for ${props.userId}: `, err);
		}
	};

	fetchLB();
	intervalId = window.setInterval(fetchLB, 15000);
});
onBeforeUnmount(() => window.clearInterval(intervalId));
</script>

<style lang="scss" scoped>
.v-enter-active,
.v-leave-active {
  transition: all 0.5s ease;
}

.v-enter-from,
.v-leave-to {
  transform: scaleY(80%);
  opacity: 0;
}

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
.listening-to {
	font-size: 0.625rem;
	margin: 0 0 0.3rem;
	color: var(--MI_THEME-accent);
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
