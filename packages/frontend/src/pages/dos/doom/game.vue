<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<template #header><MkPageHeader/></template>
	<MkSpacer :contentMax="800">
		<div class="_gaps">
			<iframe src="/client-assets/doom/doom.html" height="535" width="800" frameborder="0" border="0"></iframe>
		</div>
	</MkSpacer>
</MkStickyContainer>
</template>

<script lang="ts" setup>
import { definePageMetadata } from '@/scripts/page-metadata.js';

definePageMetadata(() => ({
	title: 'Doom',
	icon: 'ti ti-device-gamepad',
}));
</script>
