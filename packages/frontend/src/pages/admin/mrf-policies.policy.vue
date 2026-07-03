<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m">
	<MkInput v-model="draft.name" :readonly="policy.isBuiltin">
		<template #label>{{ i18n.ts.name }}</template>
	</MkInput>

	<div class="_gaps_s">
		<MkSwitch v-model="draft.enabled">
			<template #label>{{ i18n.ts.enable }}</template>
		</MkSwitch>
		<MkInput v-model="draft.priority" type="number">
			<template #label>{{ i18n.ts.priority }}</template>
			<template #caption>{{ i18n.ts._mrfPolicies.priorityCaption }}</template>
		</MkInput>
		<MkInput v-model="draft.timeoutMs" type="number" :readonly="policy.isBuiltin">
			<template #label>{{ i18n.ts._mrfPolicies.timeout }}</template>
			<template #caption>{{ i18n.ts._mrfPolicies.timeoutCaption }}</template>
		</MkInput>
	</div>

	<MkCodeEditor v-model="draft.source" lang="lua" :readonly="policy.isBuiltin">
		<template #label>{{ i18n.ts._mrfPolicies.source }}</template>
		<template #caption>{{ policy.isBuiltin ? i18n.ts._mrfPolicies.builtinSourceCaption : i18n.ts._mrfPolicies.sourceCaption }}</template>
	</MkCodeEditor>

	<MkFolder v-if="paramEntries.length > 0">
		<template #label>{{ i18n.ts._mrfPolicies.params }}</template>
		<div class="_gaps_s">
			<template v-for="entry in paramEntries" :key="entry.key">
				<MkSwitch v-if="entry.def.type === 'boolean'" v-model="draft.params[entry.key]">
					<template #label>{{ entry.def.label ?? entry.key }}</template>
					<template v-if="entry.def.description" #caption>{{ entry.def.description }}</template>
				</MkSwitch>
				<MkInput v-else-if="entry.def.type === 'integer' || entry.def.type === 'number'" v-model="draft.params[entry.key]" type="number">
					<template #label>{{ entry.def.label ?? entry.key }}</template>
					<template v-if="entry.def.description" #caption>{{ entry.def.description }}</template>
				</MkInput>
				<MkInput v-else v-model="draft.params[entry.key]">
					<template #label>{{ entry.def.label ?? entry.key }}</template>
					<template v-if="entry.def.description" #caption>{{ entry.def.description }}</template>
				</MkInput>
			</template>
		</div>
	</MkFolder>

	<MkFolder v-if="!policy.isBuiltin">
		<template #label>{{ i18n.ts._mrfPolicies.scope }}</template>
		<div class="_gaps_s">
			<MkInput v-model="scopeActivityTypes">
				<template #label>{{ i18n.ts._mrfPolicies.activityTypes }}</template>
			</MkInput>
			<MkInput v-model="scopeObjectTypes">
				<template #label>{{ i18n.ts._mrfPolicies.objectTypes }}</template>
			</MkInput>
			<span class="_caption">{{ i18n.ts._mrfPolicies.scopeCaption }}</span>
		</div>
	</MkFolder>

	<MkInfo v-if="warnings.length > 0" warn>
		<div class="_gaps_s">
			<b>{{ i18n.ts._mrfPolicies.warnings }}</b>
			<ul :class="$style.warnings">
				<li v-for="(w, i) in warnings" :key="i">{{ w.message }}</li>
			</ul>
		</div>
	</MkInfo>

	<div class="_buttons">
		<MkButton primary inline :disabled="saving" @click="save"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
		<MkButton v-if="!policy.isBuiltin" danger inline @click="remove"><i class="ti ti-trash"></i> {{ i18n.ts.delete }}</MkButton>
	</div>

	<MkFolder>
		<template #icon><i class="ti ti-flask"></i></template>
		<template #label>{{ i18n.ts._mrfPolicies.test }}</template>
		<div class="_gaps_m">
			<MkTextarea v-model="testActivity" code>
				<template #label>{{ i18n.ts._mrfPolicies.testActivity }}</template>
			</MkTextarea>
			<div class="_gaps_s">
				<MkInput v-model="testActor.uri">
					<template #label>{{ i18n.ts._mrfPolicies.actorUri }}</template>
				</MkInput>
				<MkInput v-model="testActor.host">
					<template #label>{{ i18n.ts._mrfPolicies.actorHost }}</template>
				</MkInput>
				<FormSplit>
					<MkInput v-model="testActor.followersCount" type="number">
						<template #label>{{ i18n.ts._mrfPolicies.followersCount }}</template>
					</MkInput>
					<MkInput v-model="testActor.followingCount" type="number">
						<template #label>{{ i18n.ts._mrfPolicies.followingCount }}</template>
					</MkInput>
				</FormSplit>
				<FormSplit>
					<MkInput v-model="testLocalHost">
						<template #label>{{ i18n.ts._mrfPolicies.localHost }}</template>
					</MkInput>
					<MkInput v-model="testSignerHost">
						<template #label>{{ i18n.ts._mrfPolicies.signerHost }}</template>
					</MkInput>
				</FormSplit>
			</div>
			<MkButton inline :disabled="testing" @click="runTest"><i class="ti ti-player-play"></i> {{ i18n.ts._mrfPolicies.runTest }}</MkButton>

			<div v-if="testResult" class="_panel _gaps_s" :class="$style.result">
				<MkKeyValue>
					<template #key>{{ i18n.ts._mrfPolicies.decision }}</template>
					<template #value><span :class="$style[testResult.decision.action]">{{ testResult.decision.action }}</span></template>
				</MkKeyValue>
				<MkKeyValue v-if="testResult.decision.reason">
					<template #key>{{ i18n.ts._mrfPolicies.reason }}</template>
					<template #value>{{ testResult.decision.reason }}</template>
				</MkKeyValue>
				<MkKeyValue>
					<template #key>{{ i18n.ts._mrfPolicies.duration }}</template>
					<template #value>{{ testResult.durationMs }}ms</template>
				</MkKeyValue>
				<div v-if="testResult.decision.action === 'rewrite' && testResult.decision.activity">
					<div class="_caption">{{ i18n.ts._mrfPolicies.rewrittenActivity }}</div>
					<MkCode :code="JSON.stringify(testResult.decision.activity, null, 2)" lang="json"/>
				</div>
				<div v-if="testResult.warnings.length > 0">
					<div class="_caption">{{ i18n.ts._mrfPolicies.warnings }}</div>
					<ul :class="$style.warnings">
						<li v-for="(w, i) in testResult.warnings" :key="i">{{ w.message }}</li>
					</ul>
				</div>
			</div>
		</div>
	</MkFolder>
</div>
</template>

<script lang="ts" setup>
import { ref, reactive, computed } from 'vue';
import * as Misskey from 'misskey-js';
import MkInput from '@/components/MkInput.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkCode from '@/components/MkCode.vue';
import MkCodeEditor from '@/components/MkCodeEditor.vue';
import FormSplit from '@/components/form/split.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	policy: Misskey.entities.MrfPolicy;
}>();

const emit = defineEmits<{
	(ev: 'updated', policy: Misskey.entities.MrfPolicy): void;
	(ev: 'deleted', id: string): void;
}>();

type ParamDef = { type: string; label?: string; description?: string };

// string_array params are edited as comma-separated text; arrays from the server are
// joined for display and split back into arrays on submit (see coerceParams).
function toEditableParams(schema: Record<string, ParamDef>, params: Record<string, any>): Record<string, any> {
	const out: Record<string, any> = { ...params };
	for (const [key, def] of Object.entries(schema)) {
		if (def.type === 'string_array' && Array.isArray(out[key])) {
			out[key] = out[key].join(', ');
		}
	}
	return out;
}

function coerceParams(schema: Record<string, ParamDef>, params: Record<string, any>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...params };
	for (const [key, def] of Object.entries(schema)) {
		if (!Object.hasOwn(out, key)) continue;
		if (def.type === 'integer' || def.type === 'number') {
			out[key] = Number(out[key]);
		} else if (def.type === 'string_array' && typeof out[key] === 'string') {
			out[key] = (out[key] as string).split(',').map(s => s.trim()).filter(s => s.length > 0);
		}
	}
	return out;
}

const initialSchema = { ...(props.policy.paramsSchema ?? {}) as Record<string, ParamDef> };

const draft = reactive({
	name: props.policy.name,
	enabled: props.policy.enabled,
	priority: props.policy.priority,
	timeoutMs: props.policy.timeoutMs,
	source: props.policy.source,
	// Params are dynamic (driven by the policy's paramsSchema), so the form model is untyped.
	params: toEditableParams(initialSchema, { ...(props.policy.params ?? {}) }),
});

const warnings = ref<{ code: string; key: string; message: string }[]>(props.policy.warnings ?? []);

// The active param schema. Kept in a ref (not read straight from props) so it can be
// refreshed from the server after a source edit changes which params exist.
const currentSchema = ref<Record<string, ParamDef>>(initialSchema);

const paramEntries = computed(() => Object.entries(currentSchema.value).map(([key, def]) => ({ key, def })));

function pruneParams(schema: Record<string, ParamDef>) {
	for (const key of Object.keys(draft.params)) {
		if (!Object.hasOwn(schema, key)) delete draft.params[key];
	}
}

const scopeActivityTypes = ref((props.policy.scope?.activityTypes ?? []).join(', '));
const scopeObjectTypes = ref((props.policy.scope?.objectTypes ?? []).join(', '));

function parseTypeList(raw: string): string[] | null {
	const list = raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
	return list.length > 0 ? list : null;
}

const testActivity = ref(JSON.stringify({
	type: 'Create',
	object: { type: 'Note', content: 'hello world', to: ['https://www.w3.org/ns/activitystreams#Public'] },
}, null, 2));
const testActor = reactive({ uri: 'https://remote.example/users/alice', host: 'remote.example', followersCount: 0, followingCount: 0 });
const testLocalHost = ref('example.com');
const testSignerHost = ref('remote.example');
const testing = ref(false);
const testResult = ref<Misskey.entities.AdminMrfPoliciesTestResponse | null>(null);

function applyPolicy(p: Misskey.entities.MrfPolicy) {
	draft.name = p.name;
	draft.enabled = p.enabled;
	draft.priority = p.priority;
	draft.timeoutMs = p.timeoutMs;
	draft.source = p.source;
	currentSchema.value = { ...(p.paramsSchema ?? {}) as Record<string, ParamDef> };
	draft.params = toEditableParams(currentSchema.value, { ...(p.params ?? {}) });
	scopeActivityTypes.value = (p.scope?.activityTypes ?? []).join(', ');
	scopeObjectTypes.value = (p.scope?.objectTypes ?? []).join(', ');
	warnings.value = p.warnings ?? [];
}

const saving = ref(false);

async function save() {
	if (saving.value) return;
	saving.value = true;
	try {
		const sourceChanged = !props.policy.isBuiltin && draft.source !== props.policy.source;
		// Built-in policies only allow enabled/priority/params changes; the update endpoint
		// rejects name/source/scope/timeoutMs on built-ins with cannotModifyBuiltinPolicy.
		const patch: Misskey.entities.AdminMrfPoliciesUpdateRequest = {
			id: props.policy.id,
			enabled: draft.enabled,
			priority: Number(draft.priority),
		};
		// When the source changes, the server re-derives the param schema; submitting the old
		// params would be rejected as unknown. Let the server filter compatible params instead,
		// then reseed the form from the returned policy.
		if (!sourceChanged) {
			patch.params = coerceParams(currentSchema.value, draft.params);
		}
		if (!props.policy.isBuiltin) {
			patch.name = draft.name;
			patch.timeoutMs = Number(draft.timeoutMs);
			patch.source = draft.source;
			patch.scope = {
				activityTypes: parseTypeList(scopeActivityTypes.value),
				objectTypes: parseTypeList(scopeObjectTypes.value),
			};
		}
		const updated = await os.apiWithDialog('admin/mrf-policies/update', patch);
		applyPolicy(updated);
		emit('updated', updated);
	} finally {
		saving.value = false;
	}
}

function remove() {
	os.confirm({
		type: 'warning',
		text: i18n.tsx._mrfPolicies.deleteConfirm({ name: props.policy.name }),
	}).then(({ canceled }) => {
		if (canceled) return;
		os.apiWithDialog('admin/mrf-policies/delete', { id: props.policy.id }).then(() => {
			emit('deleted', props.policy.id);
		});
	});
}

async function runTest() {
	let activity: Record<string, unknown>;
	try {
		activity = JSON.parse(testActivity.value);
	} catch {
		os.alert({ type: 'error', text: i18n.ts._mrfPolicies.invalidActivityJson });
		return;
	}
	testing.value = true;
	try {
		const result = await misskeyApi('admin/mrf-policies/test', {
			source: draft.source,
			activity,
			actor: {
				uri: testActor.uri,
				host: testActor.host,
				followersCount: Number(testActor.followersCount),
				followingCount: Number(testActor.followingCount),
			},
			localHost: testLocalHost.value,
			signerHost: testSignerHost.value,
			timeoutMs: Number(draft.timeoutMs),
			params: coerceParams(currentSchema.value, draft.params),
		});
		testResult.value = result;
		// Sync the param form to the schema the tested source actually produced, so editing
		// the source live and re-testing converges instead of leaving stale param fields.
		currentSchema.value = { ...(result.paramsSchema ?? {}) as Record<string, ParamDef> };
		pruneParams(currentSchema.value);
	} catch (err: any) {
		os.alert({ type: 'error', text: err.message ?? String(err) });
	} finally {
		testing.value = false;
	}
}
</script>

<style lang="scss" module>
.warnings {
	margin: 0;
	padding-left: 1.2em;
}

.result {
	padding: 16px;
}

.accept { color: var(--MI_THEME-success); font-weight: bold; }
.reject { color: var(--MI_THEME-error); font-weight: bold; }
.rewrite { color: var(--MI_THEME-warn); font-weight: bold; }
</style>
