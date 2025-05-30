<script setup lang="ts">
import { computed, ref } from 'vue';
import { definePage } from '@/page.js';

const tab = ref('all');
const headerTabs = computed(() => []);
import ntfylogo from '/client-assets/ntfy.svg';
import bskylogo from '/client-assets/bsky.svg';
import torlogo from '/client-assets/tor.svg';
import cobaltlogo from '/client-assets/cobalt.png';
import excalidrawlogo from '/client-assets/excalidraw.svg';
import pipedlogo from '/client-assets/piped.svg';
import uptimekumalogo from '/client-assets/uptimekuma.svg';
import MkFolder from "@/components/MkFolder.vue";

definePage(() => ({
	title: "PlasmaTrap Info",
	icon: 'ti ti-world',
}));
</script>

<template>
<MkStickyContainer>
	<template #header><MkPageHeader v-model:tab="tab" :tabs="headerTabs"/></template>

	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<h1>PlasmaTrap Info</h1>

		<MkFolder class="features-section" :defaultOpen="true">
			<template #icon>
				<i class="ph-star ph-bold"></i>
			</template>
			<template #label>
				<span>Exclusive PlasmaTrap Features</span>
			</template>
			<div class="features-content">
				<div class="feature-item">
					<h3><i class="ph-magnifying-glass ph-bold"></i> Enhanced Search</h3>
					<p>Improved search functionality with typo tolerance and flexible sorting options. Choose between chronological results or relevance-based ranking for better discovery.</p>
				</div>

				<div class="feature-item">
					<h3><i class="ph-trend-up ph-bold"></i> Top Posts <span class="_beta">Beta</span></h3>
					<p>Personalized feed showing the most engaging posts curated to your interests in the last 24 hours. Features transparent scoring with visible calculations for each post, personalized to your account.</p>
				</div>

				<div class="feature-item">
					<h3><i class="ph-broadcast ph-bold"></i> Global Antennas <span class="_beta">Beta</span></h3>
					<p>Expand your antenna reach beyond federated content by connecting to the fedi.buzz relay. Discover posts from across the fediverse that match your keywords, and automatically import them into PlasmaTrap.</p>
				</div>

				<div class="feature-item">
					<h3><i class="ph-eye ph-bold"></i> Generated Alt Text</h3>
					<p>AI-powered alt text generation using vision models. Automatically generate descriptive alt text for images to improve accessibility and save time.</p>
				</div>

				<div class="feature-item">
					<h3><i class="ph-cloud-arrow-down ph-bold"></i> Reply Backfilling</h3>
					<p>Fetch missing replies from remote posts to see the full conversation. Works with Mastodon and Misskey instances to import replies that weren't federated normally.</p>
				</div>
			</div>
		</MkFolder>


		<p>There are several more things being hosted by PlasmaTrap, we aren't just a Sharkey server!</p>

		<a href="https://plasmatrap.net" target="_blank">
			<div class="serviceHeaderBox">
				<i class="ph-planet ph-bold" style="font-size: 50px;"></i>
				<p class="header">PlasmaTrap.net</p>
			</div>
		</a>

		<p>PlasmaTrap.net is our sister instance running Iceshrimp.NET, another ActivityPub-compatible social media platform. While PlasmaTrap runs on Sharkey (based on Misskey), PlasmaTrap.net offers an alternative experience with Iceshrimp.NET's more Mastodon-like functionality.</p>

		<div class="spacer"></div>

		<a href="https://status.plasmatrap.com/status/plasmatrap" target="_blank">
			<div class="serviceHeaderBox">
				<img :src="uptimekumalogo" alt="Uptime Kuma logo" style="width: 50px; height: 50px;"/>
				<p class="header">Uptime Kuma</p>
			</div>
		</a>

		<p>Uptime Kuma is used for the status page for PlasmaTrap. It shows the current status of all services, as well as historical data.</p>

		<div class="spacer"></div>

		<a href="https://draw.plasmatrap.com" target="_blank">
			<div class="serviceHeaderBox">
				<img :src="excalidrawlogo" alt="Excalidraw logo" style="width: 50px; height: 50px;"/>
				<p class="header">Excalidraw</p>
			</div>
		</a>

		<p>Excalidraw is a whiteboard tool that lets you sketch diagrams that have a hand-drawn feel to them.<br />
		Data is stored locally in the browser and never reaches the server.</p>
		<div class="warningBox boxYellow">
			<i class="ph-warning ph-bold ph-lg"></i>
			<p>The sharing and collaboration features are not enabled.</p>
		</div>

		<div class="spacer"></div>

		<a href="https://ntfy.plasmatrap.com" target="_blank">
			<div class="serviceHeaderBox">
				<img :src="ntfylogo" alt="Ntfy logo" style="width: 50px; height: 50px;"/>
				<p class="header">Ntfy</p>
			</div>
		</a>

		<p>Ntfy is a simple notification service that allows you to send notifications to your phone, computer, or other devices.<br/>It's extremely easy to integrate into things, posting messages is just one single HTTP request.</p>

		<div class="spacer"></div>

		<div class="serviceHeaderBox">
			<img :src="bskylogo" alt="Bsky logo" style="width: 50px; height: 50px;"/>
			<p class="header">Bluesky PDS</p>
		</div>

		<div class="warningBox">
			<i class="ph-warning ph-bold ph-lg"></i>
			<p>Bluesky is <b>NOT</b> a fully decentralized protocol, account identifiers are currently stored in a centralized database controlled by Bluesky. Alternatives to this are seemingly being explored.<br />The PDS itself is also beta software.<br />Migrations are a manual process and not fully finished.<br />
			Here be dragons. If things go wrong, I cannot help you.</p>
		</div>

		<p>Bluesky is a the main implementation of ATProto, a protocol that aims to be a decentralized social media protocol, similar to ActivityPub. The PDS is a server storing user content.<br /><br />
			To receive an invite code for the PlasmaTrap PDS, send a message to @admin.</p>

		<div class="spacer"></div>

		<a href="http://plasmalm6ssxnlmwuq7jxhiusttqmrip4xrx7lj5zvyefgmb34miwjqd.onion" target="_blank">
			<div class="serviceHeaderBox">
				<img :src="torlogo" alt="Tor logo" style="width: 100px; height: 50px;"/>
				<p class="header">Hidden Service</p>
			</div>
		</a>

		<p>PlasmaTrap is also available as a Tor hidden service, which is a mirror of the main site and will behave mostly the same. It's a bit slower than the main site (but still a very fast Hidden Service).<br />It will be available wherever you can connect to Tor.</p>

	</div>
</MkStickyContainer>
</template>

<style scoped lang="scss">
	.header {
		font-weight: bold;
		font-size: 2em;
	}

	.serviceHeaderBox {
		display: flex;
		align-items: center;
		gap: 1em;
	}

	.spacer {
		margin: 32px 32px 10px;
		border-top: solid 0.5px var(--divider);
	}

	.warningBox {
		background-color: #f8d7da;
		color: #721c24;
		border: 1px solid #f5c6cb;
		border-radius: 0.5rem;
		padding: 0.25rem 0.75rem;
		display: flex;
		align-items: center;
		gap: 1.25em;
	}

	.boxYellow {
		background-color: #fff3cd;
	}

	.features-content {
		padding: 1rem;
	}

	.feature-item {
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--divider);
	}

	.feature-item:last-child {
		margin-bottom: 0;
		padding-bottom: 0;
		border-bottom: none;
	}

	.feature-item h3 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		font-size: 1.2em;
		color: var(--accent);
	}

	.feature-item p {
		margin-bottom: 0.5rem;
		line-height: 1.5;
	}

	.feature-item a {
		color: var(--link);
		text-decoration: none;
	}

	.feature-item a:hover {
		text-decoration: underline;
	}
</style>
