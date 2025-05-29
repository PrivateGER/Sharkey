<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<template #header><MkPageHeader :actions="headerActions" :tabs="headerTabs"/></template>
	<MkPullToRefresh :refresher="() => fetchPosts">
		<div class="_spacer" style="--MI_SPACER-w: 800px;">
			<div class="top-posts">
				<div v-if="!$i" class="empty">
					<img src="https://raw.githubusercontent.com/misskey-dev/misskey/develop/packages/frontend/assets/about-icon.png" class="_ghost"/>
					<div>{{ i18n.ts.signinRequired }}</div>
				</div>
				<div v-else-if="error" class="empty">
					<img src="https://raw.githubusercontent.com/misskey-dev/misskey/develop/packages/frontend/assets/about-icon.png" class="_ghost"/>
					<div>{{ error }}</div>
				</div>
				<div v-else-if="loading && posts.length === 0" class="empty">
					<MkLoading/>
				</div>
				<div v-else-if="posts.length === 0" class="empty">
					<img src="https://raw.githubusercontent.com/misskey-dev/misskey/develop/packages/frontend/assets/about-icon.png" class="_ghost"/>
					<div>{{ i18n.ts.noNotes }}</div>
				</div>
				<div v-else>
					<MkInfo v-if="showInfo" class="info" :closable="true" @close="hideInfo">
						<b>About Top Posts</b>
						<p>This feed shows the top 25 posts that are currently trending based on a scoring system that considers:</p>
						<ul>
							<li>Engagement (reactions, replies, and renotes)</li>
							<li>Recency (newer posts score higher)</li>
							<li>Following status (posts from users you follow get a boost)</li>
						</ul>
						<p>Click the info icon next to any post's score to see the detailed calculation.</p>
						<p>This feed refreshes periodically and is unique to your account. If you're new, it may take a few minutes to generate for you.</p>
					</MkInfo>

					<div class="timeline">
						<TransitionGroup name="post-list">
							<div v-for="post in posts" :key="post.note.id" class="post-item">
								<div class="post-content">
									<MkNote :note="post.note"/>
									<div class="score-badge">
										<i class="ti ti-award"></i>
										<span>{{ formatNumber(post.score) }}</span>
										<button class="info-button _button" @click="showScoreDetails(post)">
											<i class="ti ti-info-circle"></i>
										</button>
									</div>
								</div>
							</div>
						</TransitionGroup>
					</div>
				</div>
			</div>
		</div>
	</MkPullToRefresh>
</MkStickyContainer>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import MkNote from '@/components/MkNote.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import { ensureSignin } from '@/i.js';
import { definePage } from '@/page.js';

const $i = ensureSignin();

type Post = {
	note: any;
	score: number;
	scoreExplanation: any;
};

const posts = ref<Post[]>([]);
const error = ref<string | null>(null);
const loading = ref(true);
const showInfo = ref(localStorage.getItem('topPostsInfoDismissed') !== 'true');

const headerActions = computed(() => [{
	icon: 'ti ti-refresh',
	text: 'Refresh',
	handler: fetchPosts,
}]);

const headerTabs = computed(() => []);

async function fetchPosts() {
	loading.value = true;
	error.value = null;
	try {
		const data = await misskeyApi('top-posts', {
			limit: 25,
		});

		// Check if the data is an array (as expected)
		if (Array.isArray(data)) {
			posts.value = data as Post[];
		} else {
			posts.value = [];
			error.value = 'Unexpected API response format';
			console.error('Unexpected API response format', data);
		}
	} catch (err: any) {
		error.value = err.message || 'Could not load top posts';
		console.error('Error fetching top posts:', err);
	} finally {
		loading.value = false;
	}
}

function showScoreDetails(post: Post) {
	const explanation = post.scoreExplanation;

	os.alert({
		type: 'info',
		title: 'Score Details',
		text: `Total Score: ${formatNumber(explanation.total_score)}
Formula: ${explanation.formula}

Engagement Score: ${formatNumber(explanation.components.engagement.score)}
- Renotes: ${explanation.components.engagement.renotes.count} × ${explanation.components.engagement.renotes.weight} = ${formatNumber(explanation.components.engagement.renotes.contribution)}
- Replies: ${explanation.components.engagement.replies.count} × ${explanation.components.engagement.replies.weight} = ${formatNumber(explanation.components.engagement.replies.contribution)}
- Reactions: ${explanation.components.engagement.reactions.count} × ${explanation.components.engagement.reactions.weight} = ${formatNumber(explanation.components.engagement.reactions.contribution)}

Recency Factor: ${formatNumber(explanation.components.recency.factor)}
- Hours Old: ${formatNumber(explanation.components.recency.hours_old, 1)}
- Formula: ${explanation.components.recency.formula}

Following Boost: ${explanation.components.following.boost}
- Is Following: ${explanation.components.following.is_following ? 'Yes' : 'No'}`,
	});
}

function formatNumber(num: number, precision = 2): string {
	return (Math.round(num * Math.pow(10, precision)) / Math.pow(10, precision)).toString();
}

function hideInfo() {
	showInfo.value = false;
	localStorage.setItem('topPostsInfoDismissed', 'true');
}

onMounted(() => {
	fetchPosts();
});

definePage(() => ({
	title: 'Top Posts',
	icon: 'ph-trend-up ph-bold ph-lg',
}));
</script>

<style lang="scss">
.top-posts {
	margin: var(--margin);
}

.info {
	padding: 8px;
	border-radius: 8px;
	margin: 20px;

	:deep(p) {
		margin: 0.5em 0;
	}

	:deep(ul) {
		margin: 0.5em 0;
		padding-left: 1.5em;
	}

	:deep(li) {
		margin: 0.3em 0;
	}
}

.post-list-enter-active,
.post-list-leave-active {
	transition: all 0.3s ease;
}

.post-list-enter-from,
.post-list-leave-to {
	opacity: 0;
	transform: translateY(10px);
}

.post-item {
	position: relative;

	background: color-mix(in srgb, var(--MI_THEME-panel) 65%, transparent);

	&:not(:last-child) {
		border-bottom: 1px solid var(--divider);
	}
}

.post-content {
	position: relative;

	&:hover {
		background: var(--X2);
	}
}

.score-badge {
	position: absolute;
	top: 14px;
	right: 14px;
	display: flex;
	align-items: center;
	gap: 0.4em;
	background: var(--accent);
	color: var(--accentFg);
	padding: 4px 8px;
	border-radius: 999px;
	font-size: 0.85em;
	font-weight: bold;
	box-shadow: 0 2px 4px var(--shadowAlt);

	i {
		font-size: 0.95em;
	}

	.info-button {
		color: var(--accentFg);
		opacity: 0.8;
		padding: 2px;
		font-size: 0.95em;
		line-height: 1;
		border-radius: 999px;

		&:hover {
			opacity: 1;
			background: rgba(255, 255, 255, 0.2);
		}
	}
}

.empty {
	margin: auto;
	padding: 32px;
	text-align: center;
	color: var(--fg);

	img {
		vertical-align: middle;
		height: 128px;
		margin-bottom: 16px;
		opacity: 0.5;
	}
}

@media (max-width: 500px) {
	.score-badge {
		top: 0;
		right: 8px;
		padding: 3px 6px;
		font-size: 0.8em;
	}
}
</style>
