<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<div class="_gaps_m">
			<MkInfo>{{ i18n.ts._mrfPolicies.description }}</MkInfo>

			<MkFolder :defaultOpen="false">
				<template #icon><i class="ti ti-help-circle"></i></template>
				<template #label>{{ i18n.ts._mrfPolicies.reference }}</template>
				<XReference/>
			</MkFolder>

			<MkFolder v-for="policy in policies" :key="policy.id" :defaultOpen="false">
				<template #icon>
					<i v-if="!policy.enabled" class="ti ti-circle-off"></i>
					<i v-else-if="policy.isBuiltin" class="ti ti-lock"></i>
					<i v-else class="ti ti-code"></i>
				</template>
				<template #label>{{ policy.name }}</template>
				<template #suffix>
					<span v-if="policy.isBuiltin" :class="$style.badge">{{ i18n.ts._mrfPolicies.builtin }}</span>
					<span>{{ i18n.ts.priority }}: {{ policy.priority }}</span>
					<span :class="policy.enabled ? $style.on : $style.off">{{ policy.enabled ? i18n.ts.enabled : i18n.ts.disabled }}</span>
				</template>
				<XPolicy :policy="policy" @updated="onUpdated" @deleted="onDeleted"/>
			</MkFolder>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import * as Misskey from 'misskey-js';
import XPolicy from './mrf-policies.policy.vue';
import XReference from './mrf-policies.reference.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const policies = ref<Misskey.entities.MrfPolicy[]>([]);

function sortPolicies() {
	policies.value.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

// Bumped whenever local state changes so an in-flight list response that predates the
// mutation can't clobber it (e.g. a create finishing before the initial load resolves).
let refreshToken = 0;

async function refresh() {
	const token = ++refreshToken;
	const fetched = await misskeyApi('admin/mrf-policies/list', {});
	if (token !== refreshToken) return;
	policies.value = fetched;
	sortPolicies();
}

function onUpdated(policy: Misskey.entities.MrfPolicy) {
	refreshToken++;
	const idx = policies.value.findIndex(p => p.id === policy.id);
	if (idx !== -1) policies.value[idx] = policy;
	sortPolicies();
}

function onDeleted(id: string) {
	refreshToken++;
	policies.value = policies.value.filter(p => p.id !== id);
}

async function create() {
	const { canceled, result: name } = await os.inputText({
		title: i18n.ts.name,
		default: i18n.ts._mrfPolicies.newPolicyName,
	});
	if (canceled || !name) return;

	const created = await os.apiWithDialog('admin/mrf-policies/create', {
		name,
		enabled: false,
		source: 'function filter(ctx)\n\treturn mrf.accept()\nend\n',
	});
	policies.value.push(created);
	sortPolicies();
	// Re-sync with the server; this also discards any still-in-flight initial load whose
	// response predates the create.
	refresh();
}

refresh();

const headerActions = computed(() => [{
	asFullButton: true,
	icon: 'ti ti-plus',
	text: i18n.ts._mrfPolicies.createPolicy,
	handler: create,
}]);

definePage(() => ({
	title: i18n.ts.mrfPolicies,
	icon: 'ti ti-filter-code',
}));
</script>

<style lang="scss" module>
.badge {
	padding: 2px 6px;
	border-radius: 6px;
	background: var(--MI_THEME-buttonBg);
	font-size: 0.85em;
}

.on { color: var(--MI_THEME-success); }
.off { color: var(--MI_THEME-fgTransparentWeak); }
</style>
