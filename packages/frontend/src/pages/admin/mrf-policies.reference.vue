<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m">
	<div>
		<p :class="$style.lead">{{ i18n.ts._mrfPolicies._reference.contract }}</p>
		<MkCode :code="contractExample" lang="lua"/>
	</div>

	<section v-for="group in groups" :key="group.title" class="_gaps_s">
		<div :class="$style.groupTitle">{{ group.title }}</div>
		<p v-if="group.note" :class="$style.note">{{ group.note }}</p>
		<table :class="$style.table">
			<tbody>
				<tr v-for="row in group.rows" :key="row.sig">
					<td :class="$style.sig"><code>{{ row.sig }}</code></td>
					<td :class="$style.desc">{{ row.desc }}</td>
				</tr>
			</tbody>
		</table>
	</section>

	<div>
		<div :class="$style.groupTitle">{{ i18n.ts._mrfPolicies._reference.example }}</div>
		<MkCode :code="workedExample" lang="lua"/>
	</div>

	<MkInfo warn>{{ i18n.ts._mrfPolicies._reference.sandboxNote }}</MkInfo>
</div>
</template>

<script lang="ts" setup>
import MkCode from '@/components/MkCode.vue';
import MkInfo from '@/components/MkInfo.vue';
import { i18n } from '@/i18n.js';

const t = i18n.ts._mrfPolicies._reference;

const contractExample = `-- Optional: declare configurable parameters (shown as form fields).
policy = {
\tparams = {
\t\tmax_mentions = { type = "integer", default = 5, label = "Max mentions" },
\t\tblocked_words = { type = "string_array", default = {} },
\t},
}

-- Required: filter(ctx) runs for every matching inbound activity.
function filter(ctx)
\treturn mrf.accept()
end`;

const workedExample = `function filter(ctx)
\tlocal note = mrf.activity.note(ctx.activity)
\tif note == nil then
\t\treturn mrf.accept()
\tend

\t-- Reject hellthreads.
\tif mrf.note.mention_count(note) > ctx.params.max_mentions then
\t\treturn mrf.reject("too many mentions")
\tend

\t-- Force-CW posts from brand-new remote accounts.
\tif (ctx.actor.followersCount or 0) < 1 then
\t\tmrf.note.mark_sensitive(note, "new account")
\t\treturn mrf.rewrite(ctx.activity, "cw new account")
\tend

\treturn mrf.accept()
end`;

const groups = [
	{
		title: t.contextTitle,
		note: t.contextNote,
		rows: [
			{ sig: 'ctx.activity', desc: t.ctxActivity },
			{ sig: 'ctx.actor.uri', desc: t.ctxActorUri },
			{ sig: 'ctx.actor.host', desc: t.ctxActorHost },
			{ sig: 'ctx.actor.followersCount', desc: t.ctxFollowers },
			{ sig: 'ctx.actor.followingCount', desc: t.ctxFollowing },
			{ sig: 'ctx.localHost', desc: t.ctxLocalHost },
			{ sig: 'ctx.signerHost', desc: t.ctxSignerHost },
			{ sig: 'ctx.receivedAt', desc: t.ctxReceivedAt },
			{ sig: 'ctx.params.<key>', desc: t.ctxParams },
		],
	},
	{
		title: t.decisionsTitle,
		rows: [
			{ sig: 'mrf.accept(reason?)', desc: t.decAccept },
			{ sig: 'mrf.reject(reason)', desc: t.decReject },
			{ sig: 'mrf.rewrite(activity, reason?)', desc: t.decRewrite },
		],
	},
	{
		title: t.activityTitle,
		rows: [
			{ sig: 'mrf.activity.type(activity)', desc: t.actType },
			{ sig: 'mrf.activity.object(activity)', desc: t.actObject },
			{ sig: 'mrf.activity.actor_uri(activity)', desc: t.actActorUri },
			{ sig: 'mrf.activity.note(activity)', desc: t.actNote },
		],
	},
	{
		title: t.noteTitle,
		rows: [
			{ sig: 'mrf.note.content(note)', desc: t.noteContent },
			{ sig: 'mrf.note.mentions(note)', desc: t.noteMentions },
			{ sig: 'mrf.note.mention_count(note)', desc: t.noteMentionCount },
			{ sig: 'mrf.note.remove_mentions(note)', desc: t.noteRemoveMentions },
			{ sig: 'mrf.note.mark_sensitive(note, reason?)', desc: t.noteMarkSensitive },
			{ sig: 'mrf.note.unlist(note)', desc: t.noteUnlist },
			{ sig: 'mrf.note.has_media(note)', desc: t.noteHasMedia },
		],
	},
	{
		title: t.lookupTitle,
		note: t.lookupSectionNote,
		rows: [
			{ sig: 'mrf.lookup.user_by_uri(uri)', desc: t.lookupUserUri },
			{ sig: 'mrf.lookup.user_by_mention(mention)', desc: t.lookupUserMention },
			{ sig: 'mrf.lookup.instance_by_host(host)', desc: t.lookupInstance },
			{ sig: 'mrf.lookup.note_by_uri(uri)', desc: t.lookupNoteUri },
		],
	},
	{
		title: t.miscTitle,
		rows: [
			{ sig: 'mrf.is_nil(value)', desc: t.miscIsNil },
		],
	},
];
</script>

<style lang="scss" module>
.lead {
	margin: 0 0 8px;
}

.groupTitle {
	font-weight: bold;
	margin-bottom: 4px;
}

.note {
	margin: 0 0 6px;
	opacity: 0.8;
	font-size: 0.9em;
}

.table {
	width: 100%;
	border-collapse: collapse;
}

.table td {
	vertical-align: top;
	padding: 4px 8px 4px 0;
	border-bottom: 1px solid var(--MI_THEME-divider);
}

.sig {
	white-space: nowrap;

	> code {
		font-family: Consolas, Monaco, monospace;
		font-size: 0.9em;
	}
}

.desc {
	width: 100%;
	opacity: 0.9;
}
</style>
