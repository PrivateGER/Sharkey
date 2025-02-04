<script setup lang="ts">
import { computed, ref } from 'vue';
import {definePageMetadata} from "@/scripts/page-metadata.js";

const tab = ref('all');
const headerTabs = computed(() => []);
import ntfylogo from '/client-assets/ntfy.svg';
import bskylogo from '/client-assets/bsky.svg';
import torlogo from '/client-assets/tor.svg';
import cobaltlogo from '/client-assets/cobalt.png';
import excalidrawlogo from '/client-assets/excalidraw.svg';
import pipedlogo from '/client-assets/piped.svg';
import uptimekumalogo from '/client-assets/uptimekuma.svg';

definePageMetadata(() => ({
	title: "PlasmaTrap Services",
	icon: 'ti ti-world',
}));
</script>

<template>
<MkStickyContainer>
	<template #header><MkPageHeader v-model:tab="tab" :tabs="headerTabs"/></template>

	<MkSpacer :contentMax="800">
		<h1>PlasmaTrap-owned services</h1>
		<p>There are several more things being hosted by PlasmaTrap, we aren't just a Sharkey server!</p>

		<a href="https://status.plasmatrap.com/status/plasmatrap" target="_blank">
			<div class="serviceHeaderBox">
				<img :src="uptimekumalogo" alt="Uptime Kuma logo" style="width: 50px; height: 50px;"/>
				<p class="header">Uptime Kuma</p>
			</div>
		</a>

		<p>Uptime Kuma is used for the status page for PlasmaTrap. It shows the current status of all services, as well as historical data.</p>

		<div class="spacer"></div>

		<a href="https://piped.plasmatrap.com" target="_blank">
			<div class="serviceHeaderBox">
				<img :src="pipedlogo" alt="Piped logo" style="width: 50px; height: 50px;"/>
				<p class="header">Piped</p>
			</div>
		</a>

		<p>Piped is an alternative YouTube frontend. No ads, no tracking, SponsorBlock integration, lightweight, and with support for accounts.<br />It can also bypass age restrictions and geo restrictions (partially).</p>
		<div class="warningBox boxYellow">
			<i class="ph-warning ph-bold ph-lg"></i>
			<p>YouTube is currently in a fight trying to block any unofficial bots or frontends.<br />
			Most, if not all, alternative YouTube frontends are <i>currently</i> broken.</p>
		</div>

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

		<a href="https://cobalt.plasmatrap.com" target="_blank">
			<div class="serviceHeaderBox">
				<img :src="cobaltlogo" alt="Cobalt logo" style="width: 50px; height: 50px;"/>
				<p class="header">Cobalt</p>
			</div>
		</a>

		<p>Cobalt is a video and audio downloader service supporting <a href="https://github.com/imputnet/cobalt?tab=readme-ov-file#supported-services" target="_blank">a whole bunch</a> of sites.</p>

		<div class="spacer"></div>

		<a href="http://plasmalm6ssxnlmwuq7jxhiusttqmrip4xrx7lj5zvyefgmb34miwjqd.onion" target="_blank">
			<div class="serviceHeaderBox">
				<img :src="torlogo" alt="Tor logo" style="width: 100px; height: 50px;"/>
				<p class="header">Hidden Service</p>
			</div>
		</a>

		<p>PlasmaTrap is also available as a Tor hidden service, which is a mirror of the main site and will behave mostly the same. It's a bit slower than the main site (but still a very fast Hidden Service).<br />It will be available wherever you can connect to Tor.</p>

	</MkSpacer>
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
			margin: 32px 32px;
			margin-bottom: 10px;
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
</style>
