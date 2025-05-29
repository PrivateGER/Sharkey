<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<template #header><MkPageHeader/></template>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<iframe src="/client-assets/doom/doom.html" height="535" width="800" frameborder="0" border="0"></iframe>
		</div>
	</div>
</MkStickyContainer>
</template>

<script lang="ts" setup>
import { definePage } from '@/page.js';

definePage(() => ({
	title: 'Doom',
	icon: 'ti ti-device-gamepad',
}));
</script>
