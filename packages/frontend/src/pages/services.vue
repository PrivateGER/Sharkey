<script setup lang="ts">
import { computed, ref } from 'vue';
import { definePage } from '@/page.js';
import MkFolder from '@/components/MkFolder.vue';
import MkContainer from '@/components/MkContainer.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';

const tab = ref('all');
const headerTabs = computed(() => []);

// Import logos
import ntfylogo from '/client-assets/ntfy.svg';
import bskylogo from '/client-assets/bsky.svg';
import torlogo from '/client-assets/tor.svg';
import cobaltlogo from '/client-assets/cobalt.png';
import excalidrawlogo from '/client-assets/excalidraw.svg';
import pipedlogo from '/client-assets/piped.svg';
import uptimekumalogo from '/client-assets/uptimekuma.svg';
import MkMention from '@/components/MkMention.vue';

definePage(() => ({
	title: 'PlasmaTrap Info',
	icon: 'ti ti-world',
}));
</script>

<template>
<MkStickyContainer>
	<template #header><MkPageHeader v-model:tab="tab" :tabs="headerTabs"/></template>

	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<!-- Introduction Section -->
			<div style="text-align: center; padding: 2rem 0;">
				<img
					src="https://minio.plasmatrap.com/plasmatrap/b3839ce5-d4e9-428e-b6f9-28a325ea65b2.webp"
					alt="PlasmaTrap Logo"
					style="max-width: 200px; height: auto; margin-bottom: 1rem;"
				/>
				<h1 style="margin: 0.5rem 0;">Welcome to PlasmaTrap</h1>
				<p style="font-size: 1.1em; color: var(--MI_THEME-fg); opacity: 0.8; max-width: 600px; margin: 0 auto;">
					Your home in the fediverse. PlasmaTrap is more than just a Sharkey server – we offer many unique features and host various services for our community.
				</p>
			</div>

			<MkFolder class="features-section" :defaultOpen="true">
				<template #icon>
					<i class="ph-star ph-bold"></i>
				</template>
				<template #label>
					<span>Exclusive PlasmaTrap Features</span>
				</template>

				<div class="_gaps_s" style="padding: 16px;">
					<MkContainer :naked="true" :thin="true">
						<template #header>
							<i class="ph-magnifying-glass ph-bold"></i> Enhanced Search
						</template>
						<p>Improved search functionality with typo tolerance and flexible sorting options. Choose between chronological results or relevance-based ranking for better discovery.</p>
					</MkContainer>

					<MkContainer :naked="true" :thin="true">
						<template #header>
							<i class="ph-trend-up ph-bold"></i> Top Posts <span class="_beta">Beta</span>
						</template>
						<p>Personalized feed showing the most engaging posts curated to your interests in the last 24 hours. Features transparent scoring with visible calculations for each post, personalized to your account.</p>
					</MkContainer>

					<MkContainer :naked="true" :thin="true">
						<template #header>
							<i class="ph-broadcast ph-bold"></i> Global Antennas <span class="_beta">Beta</span>
						</template>
						<p>Expand your antenna reach beyond federated content by connecting to the fedi.buzz relay. Discover posts from across the fediverse that match your keywords, and automatically import them into PlasmaTrap.</p>
					</MkContainer>

					<MkContainer :naked="true" :thin="true">
						<template #header>
							<i class="ph-eye ph-bold"></i> Generated Alt Text
						</template>
						<p>AI-powered alt text generation using vision models. Automatically generate descriptive alt text for images to improve accessibility and save time.</p>
					</MkContainer>

					<MkContainer :naked="true" :thin="true">
						<template #header>
							<i class="ph-cloud-arrow-down ph-bold"></i> Reply Backfilling
						</template>
						<p>Fetch missing replies from remote posts to see the full conversation. Works with Mastodon and Misskey instances to import replies that weren't federated normally.</p>
					</MkContainer>
				</div>
			</MkFolder>

			<p>There are several more things being hosted by PlasmaTrap, we aren't just a Sharkey server!</p>

			<!-- PlasmaTrap.net -->
			<MkContainer>
				<template #icon>
					<i class="ph-planet ph-bold"></i>
				</template>
				<template #header>
					PlasmaTrap.NET
				</template>
				<div style="padding: 16px;">
					<p>PlasmaTrap.net is our sister instance running Iceshrimp.NET, another ActivityPub-compatible social media platform. While PlasmaTrap runs on Sharkey (based on Misskey), PlasmaTrap.net offers an alternative experience with Iceshrimp.NET's more Mastodon-like functionality.</p>
					<div style="padding-top: 8px;">
						<MkButton primary rounded link external to="https://plasmatrap.net" target="_blank">
							<i class="ti ti-external-link"></i> Visit PlasmaTrap.net
						</MkButton>
					</div>
				</div>
			</MkContainer>

			<!-- Uptime Kuma -->
			<MkContainer>
				<template #icon>
					<img :src="uptimekumalogo" alt="Uptime Kuma logo" style="max-width: 20px;"/>
				</template>
				<template #header>
					Uptime Kuma
				</template>
				<div style="padding: 16px;">
					<p>Uptime Kuma is used for the status page for PlasmaTrap. It shows the current status of all services, as well as historical data.</p>
					<div style="padding-top: 8px;">
						<MkButton primary rounded link external to="https://status.plasmatrap.com/status/plasmatrap" target="_blank">
							<i class="ti ti-external-link"></i> View Status Page
						</MkButton>
					</div>
				</div>
			</MkContainer>

			<!-- Excalidraw -->
			<MkContainer>
				<template #icon>
					<img :src="excalidrawlogo" alt="Excalidraw logo" style="max-width: 20px;"/>
				</template>
				<template #header>
					Excalidraw
				</template>
				<div style="padding: 16px;">
					<p>Excalidraw is a whiteboard tool that lets you sketch diagrams that have a hand-drawn feel to them. Data is stored locally in the browser and never reaches the server.</p>
					<MkInfo warn>
						<span>The sharing and collaboration features are not enabled.</span>
					</MkInfo>
					<div style="padding-top: 8px;">
						<MkButton primary rounded link external to="https://draw.plasmatrap.com" target="_blank">
							<i class="ti ti-external-link"></i> Open Excalidraw
						</MkButton>
					</div>
				</div>
			</MkContainer>

			<!-- Ntfy -->
			<MkContainer>
				<template #icon>
					<img :src="ntfylogo" alt="Ntfy logo" style="max-width: 20px"/>
				</template>
				<template #header>
					Ntfy
				</template>
				<div style="padding: 16px;">
					<p>Ntfy is a simple notification service that allows you to send notifications to your phone, computer, or other devices. It's extremely easy to integrate into things, posting messages is just one single HTTP request.</p>
					<div style="padding-top: 8px;">
						<MkButton primary rounded link external to="https://ntfy.plasmatrap.com" target="_blank">
							<i class="ti ti-external-link"></i> Open Ntfy
						</MkButton>
					</div>
				</div>
			</MkContainer>

			<!-- Bluesky PDS -->
			<MkContainer>
				<template #icon>
					<img :src="bskylogo" alt="Bsky logo" style="max-height: 20px;"/>
				</template>
				<template #header>
					Bluesky PDS
				</template>
				<div style="padding: 16px;">
					<MkInfo warn>
						<span>Bluesky is <b>NOT</b> a fully decentralized protocol, account identifiers are currently stored in a centralized database controlled by Bluesky. Alternatives to this are seemingly being explored.<br/>
							The PDS itself is also beta software.<br/>
							Migrations are a manual process and not fully finished.<br/>
							Here be dragons. If things go wrong, I cannot help you.</span>
					</MkInfo>
					<p>Bluesky is a the main implementation of ATProto, a protocol that aims to be a decentralized social media protocol, similar to ActivityPub. The PDS is a server storing user content.</p>
					<p>To receive an invite code for the PlasmaTrap PDS, send a message to <MkMention username="admin" host="plasmatrap.com"/>.</p>
				</div>
			</MkContainer>

			<!-- Tor Hidden Service -->
			<MkContainer>
				<template #icon>
					<img :src="torlogo" alt="Tor logo" style="max-height: 20px;"/>
				</template>
				<template #header>
					Hidden Service
				</template>
				<div style="padding: 16px;">
					<p>PlasmaTrap is also available as a Tor hidden service, which is a mirror of the main site and will behave mostly the same. It's a bit slower than the main site (but still a very fast Hidden Service). It will be available wherever you can connect to Tor.</p>
					<div style="padding-top: 8px;">
						<MkButton primary rounded link external to="http://plasmalm6ssxnlmwuq7jxhiusttqmrip4xrx7lj5zvyefgmb34miwjqd.onion" target="_blank">
							<i class="ti ti-external-link"></i> Open Hidden Service
						</MkButton>
					</div>
				</div>
			</MkContainer>
		</div>
	</div>
</MkStickyContainer>
</template>

<style scoped lang="scss">
</style>
