<!--
SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkInfo v-if="showRemoteWarning" warn closable @close="close">
	{{ i18n.ts.remoteFollowersWarning }}
</MkInfo>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { i18n } from '@/i18n.js';
import MkInfo from '@/components/MkInfo.vue';
import { followersTab, FollowingFeedModel } from '@/scripts/following-feed-utils.js';

const props = defineProps<{
	model: FollowingFeedModel,
}>();

// eslint-disable-next-line vue/no-setup-props-reactivity-loss
const { model: { userList, remoteWarningDismissed } } = props;

const showRemoteWarning = computed(
	() => userList.value === followersTab && !remoteWarningDismissed.value,
);

function close() {
	remoteWarningDismissed.value = true;
}
</script>
