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

				<!-- Discord link -->
				<div class="discord-section">
					<a href="https://discord.gg/2yFXBDAPAJ" target="_blank" class="discord-link">
						<div class="discord-icon-container">
							<svg width="24" height="18" viewBox="0 0 65 48" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M41.2351 0C40.6164 1.09866 40.0607 2.2352 39.5556 3.397C34.7569 2.67719 29.8697 2.67719 25.0584 3.397C24.5658 2.2352 23.9976 1.09866 23.3788 0C18.8705 0.770324 14.4759 2.12155 10.3085 4.02841C2.04967 16.2652 -0.185531 28.1863 0.925755 39.9432C5.76238 43.517 11.1799 46.2447 16.951 47.9874C18.2517 46.2447 19.4009 44.3883 20.3859 42.4562C18.5169 41.7616 16.7111 40.8903 14.981 39.88C15.4356 39.5517 15.8776 39.2107 16.307 38.8824C26.4475 43.6559 38.1917 43.6559 48.3449 38.8824C48.7742 39.236 49.2162 39.577 49.6708 39.88C47.9408 40.9029 46.1349 41.7616 44.2533 42.4688C45.2383 44.4009 46.3875 46.2573 47.6882 48C53.4593 46.2573 58.8768 43.5422 63.7134 39.9684C65.0268 26.3299 61.4656 14.5099 54.3054 4.04104C50.1507 2.13418 45.7561 0.782952 41.2478 0.0252565L41.2351 0ZM21.8003 32.7072C18.6811 32.7072 16.0923 29.8785 16.0923 26.3804C16.0923 22.8824 18.5801 20.041 21.7876 20.041C24.9952 20.041 27.5461 22.895 27.4956 26.3804C27.4451 29.8658 24.9826 32.7072 21.8003 32.7072ZM42.8389 32.7072C39.7071 32.7072 37.1436 29.8785 37.1436 26.3804C37.1436 22.8824 39.6314 20.041 42.8389 20.041C46.0465 20.041 48.5848 22.895 48.5343 26.3804C48.4838 29.8658 46.0213 32.7072 42.8389 32.7072Z" fill="white"/>
							</svg>
						</div>
						<div class="discord-text">
							<span class="discord-title">Join our Discord</span>
							<span class="discord-subtitle">Connect with the community</span>
						</div>
					</a>
				</div>
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
			<MkFolder :defaultOpen="false">
				<template #icon>
					<i class="ph-planet ph-bold"></i>
				</template>
				<template #label>
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
			</MkFolder>

			<!-- Uptime Kuma -->
			<MkFolder :defaultOpen="false">
				<template #icon>
					<img :src="uptimekumalogo" alt="Uptime Kuma logo" style="max-width: 20px;"/>
				</template>
				<template #label>
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
			</MkFolder>

			<!-- Excalidraw -->
			<MkFolder :defaultOpen="false">
				<template #icon>
					<img :src="excalidrawlogo" alt="Excalidraw logo" style="max-width: 20px;"/>
				</template>
				<template #label>
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
			</MkFolder>

			<!-- Ntfy -->
			<MkFolder :defaultOpen="false">
				<template #icon>
					<img :src="ntfylogo" alt="Ntfy logo" style="max-width: 20px"/>
				</template>
				<template #label>
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
			</MkFolder>

			<!-- Bluesky PDS -->
			<MkFolder :defaultOpen="false">
				<template #icon>
					<img :src="bskylogo" alt="Bsky logo" style="max-height: 20px;"/>
				</template>
				<template #label>
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
			</MkFolder>

			<!-- Tor Hidden Service -->
			<MkFolder :defaultOpen="false">
				<template #icon>
					<img :src="torlogo" alt="Tor logo" style="max-height: 20px;"/>
				</template>
				<template #label>
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
			</MkFolder>
		</div>
	</div>
</MkStickyContainer>
</template>

<style scoped lang="scss">
.discord-section {
	margin: 2rem 0;
}

.discord-link {
	display: inline-flex;
	align-items: center;
	gap: 16px;
	text-decoration: none;
	color: var(--MI_THEME-fg);
	padding: 16px 24px;
	background: linear-gradient(135deg, color-mix(in srgb, #5865F2 12%, transparent), color-mix(in srgb, #7289DA 8%, transparent));
	border: 1px solid color-mix(in srgb, #5865F2 25%, transparent);
	border-radius: 16px;
	backdrop-filter: blur(8px);
	box-shadow: 0 4px 16px color-mix(in srgb, #5865F2 15%, transparent), 0 2px 8px color-mix(in srgb, #000 10%, transparent);
	transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

	&:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 24px color-mix(in srgb, #5865F2 25%, transparent), 0 4px 12px color-mix(in srgb, #000 15%, transparent);
	}
}

.discord-icon-container {
	padding: 12px;
	background: linear-gradient(135deg, #5865F2, #7289DA);
	border-radius: 12px;
	box-shadow: 0 2px 8px color-mix(in srgb, #5865F2 30%, transparent);
	display: flex;
	align-items: center;
	justify-content: center;
}

.discord-text {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.discord-title {
	font-weight: 600;
	font-size: 1.1em;
	letter-spacing: -0.02em;
}

.discord-subtitle {
	font-size: 0.85em;
	opacity: 0.8;
	font-weight: 400;
}
</style>
