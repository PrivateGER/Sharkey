/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as assert from 'assert';
import type { IActivity } from '@/core/activitypub/type.js';
import { MrfLuaPolicyService } from '@/core/activitypub/mrf/MrfLuaPolicyService.js';
import type { MrfLuaPolicy } from '@/core/activitypub/mrf/MrfLuaPolicyService.js';

const baseActivity = {
	id: 'https://remote.example/activities/1',
	type: 'Create',
	actor: 'https://remote.example/users/alice',
	object: {
		id: 'https://remote.example/notes/1',
		type: 'Note',
		content: 'hello',
		tag: [],
	},
} satisfies IActivity;

const builtinPolicyFixtures = [
	{
		id: 'keyword-filter',
		name: 'Keyword filter',
		source: `
			policy = {
				params = {
					keywords = {
						type = "string_array",
						default = {
							"https://discord.gg/ctkpaarr",
							"@ap12@mastodon-japan.net",
							"ctkpaarr",
						},
						label = "Blocked keywords",
					},
				},
			}

			function filter(ctx)
				local note = mrf.activity.note(ctx.activity)
				if note == nil then
					return mrf.accept()
				end

				local content = mrf.note.content(note)
				if type(content) ~= "string" then
					return mrf.accept()
				end

				for _, keyword in ipairs(ctx.params.keywords) do
					if string.find(content, keyword, 1, true) ~= nil then
						return mrf.reject("keyword filter matched: " .. keyword)
					end
				end

				return mrf.accept()
			end
		`,
	},
	{
		id: 'new-user-spam',
		name: 'New user spam mention filter',
		source: `
			policy = {
				params = {
					maxFollowers = {
						type = "integer",
						default = 0,
						label = "Maximum followers",
					},
					maxFollowing = {
						type = "integer",
						default = 0,
						label = "Maximum following",
					},
					onlyTopLevelPosts = {
						type = "boolean",
						default = true,
						label = "Only top-level posts",
					},
				},
			}

			function filter(ctx)
				local note = mrf.activity.note(ctx.activity)
				if note == nil then
					return mrf.accept()
				end

				local mentions = mrf.note.mentions(note)
				if #mentions == 0 then
					return mrf.accept()
				end

				local local_prefix = "https://" .. ctx.localHost
				local has_local_mention = false
				for _, mention in ipairs(mentions) do
					if type(mention.href) == "string" and string.sub(mention.href, 1, #local_prefix) == local_prefix then
						has_local_mention = true
						break
					end
				end

				if not has_local_mention then
					return mrf.accept()
				end

				if (ctx.actor.followersCount or 0) <= ctx.params.maxFollowers and (ctx.actor.followingCount or 0) <= ctx.params.maxFollowing and (not ctx.params.onlyTopLevelPosts or mrf.is_nil(note.inReplyTo)) then
					mrf.note.remove_mentions(note)
					return mrf.rewrite(ctx.activity, "stripped unsolicited local mentions from new remote actor")
				end

				return mrf.accept()
			end
		`,
	},
	{
		id: 'hellthread',
		name: 'Hellthread mention filter',
		source: `
			policy = {
				params = {
					mentionThreshold = {
						type = "integer",
						default = 15,
						label = "Mention threshold",
					},
				},
			}

			function filter(ctx)
				local note = mrf.activity.note(ctx.activity)
				if note == nil then
					return mrf.accept()
				end

				if mrf.note.mention_count(note) >= ctx.params.mentionThreshold then
					mrf.note.remove_mentions(note)
					return mrf.rewrite(ctx.activity, "stripped hellthread mentions")
				end

				return mrf.accept()
			end
		`,
	},
] satisfies MrfLuaPolicy[];

function createService() {
	return new MrfLuaPolicyService({
		defaultTimeoutMs: 100,
		defaultMemoryLimitBytes: 1024 * 1024 * 4,
	});
}

async function runBundledPolicies(activity: IActivity, actor: { uri: string; host: string; followersCount: number; followingCount: number }) {
	const service = createService();
	let currentActivity = structuredClone(activity);
	const decisions: Array<{ policyId: string; action: string; activity: IActivity }> = [];

	for (const policy of builtinPolicyFixtures) {
		const result = await service.run(policy, {
			activity: currentActivity,
			actor,
			localHost: 'local.example',
			signerHost: actor.host,
			receivedAt: '2026-06-14T00:00:00.000Z',
		});
		decisions.push({
			policyId: policy.id,
			action: result.decision.action,
			activity: currentActivity,
		});

		if (result.decision.action === 'rewrite') {
			currentActivity = result.decision.activity;
		}

		if (result.decision.action === 'reject') {
			break;
		}
	}

	return {
		activity: currentActivity,
		decisions,
	};
}

function createRealisticReplyActivity() {
	return {
		id: 'https://remote.example/users/alice/statuses/1/activity',
		type: 'Create',
		actor: 'https://remote.example/users/alice',
		to: ['https://www.w3.org/ns/activitystreams#Public'],
		cc: ['https://remote.example/users/alice/followers', 'https://local.example/users/bob'],
		object: {
			id: 'https://remote.example/users/alice/statuses/1',
			type: 'Note',
			to: ['https://www.w3.org/ns/activitystreams#Public'],
			cc: ['https://remote.example/users/alice/followers', 'https://local.example/users/bob'],
			tag: [
				{ type: 'Mention', href: 'https://local.example/users/bob', name: '@bob@local.example' },
				{ type: 'Hashtag', href: 'https://remote.example/tags/test', name: '#test' },
			],
			content: '<p><span class="h-card"><a href="https://local.example/@bob" class="u-url mention">@<span>bob</span></a></span> hello</p>',
			inReplyTo: 'https://local.example/users/bob/statuses/1',
			published: '2026-06-14T00:00:00Z',
			sensitive: false,
			attachment: [],
			attributedTo: 'https://remote.example/users/alice',
		},
	} satisfies IActivity;
}

function createHellthreadReplayActivity() {
	const activity = createRealisticReplyActivity();
	const note = activity.object as typeof activity.object & { tag: Array<Record<string, string>> };
	note.tag = [
		...Array.from({ length: 15 }, (_, i) => ({
			type: 'Mention',
			href: `https://remote${i}.example/users/person${i}`,
			name: `@person${i}@remote${i}.example`,
		})),
		{ type: 'Hashtag', href: 'https://remote.example/tags/kept', name: '#kept' },
	];
	return activity;
}

function createNewUserSpamReplayActivity() {
	const activity = createRealisticReplyActivity();
	const note = activity.object as { inReplyTo: string | null; tag: Array<Record<string, string>> };
	note.inReplyTo = null;
	note.tag = [
		{ type: 'Mention', href: 'https://local.example/users/bob', name: '@bob@local.example' },
		{ type: 'Mention', href: 'https://remote.example/users/carol', name: '@carol@remote.example' },
		{ type: 'Hashtag', href: 'https://remote.example/tags/kept', name: '#kept' },
	];
	return activity;
}

describe('MrfLuaPolicyService', () => {
	test('returns an accept decision from a Lua policy', async () => {
		const service = createService();

		const result = await service.run({
			id: 'accept',
			name: 'Accept Policy',
			source: `
				function filter(ctx)
					return mrf.accept("no changes")
				end
			`,
		}, {
			activity: baseActivity,
			actor: {
				uri: 'https://remote.example/users/alice',
				host: 'remote.example',
			},
			localHost: 'local.example',
			signerHost: 'remote.example',
			receivedAt: '2026-06-14T00:00:00.000Z',
		});

		assert.deepStrictEqual(result.decision, {
			action: 'accept',
			reason: 'no changes',
		});
		assert.equal(result.policy.id, 'accept');
	});

	test('returns a rewritten cloned activity without mutating the caller activity', async () => {
		const service = createService();

		const result = await service.run({
			id: 'rewrite',
			name: 'Rewrite Policy',
			source: `
				function filter(ctx)
					ctx.activity.object.content = "rewritten"
					return mrf.rewrite(ctx.activity, "changed content")
				end
			`,
		}, {
			activity: baseActivity,
			actor: {
				uri: 'https://remote.example/users/alice',
				host: 'remote.example',
			},
			localHost: 'local.example',
			signerHost: 'remote.example',
			receivedAt: '2026-06-14T00:00:00.000Z',
		});

		assert.equal(result.decision.action, 'rewrite');
		assert.equal(result.decision.reason, 'changed content');
		if (result.decision.action === 'rewrite') {
			assert.equal((result.decision.activity.object as { content: string }).content, 'rewritten');
		}
		assert.equal(baseActivity.object.content, 'hello');
	});

	test('does not expose unsafe Lua standard library globals', async () => {
		const service = createService();

		const result = await service.run({
			id: 'sandbox',
			name: 'Sandbox Policy',
			source: `
				function filter(ctx)
					if os ~= nil or io ~= nil or package ~= nil or debug ~= nil or require ~= nil or Promise ~= nil or Error ~= nil then
						return mrf.reject("unsafe global exposed")
					end
					if __mrf_accept ~= nil or __mrf_lookup_user_by_uri ~= nil then
						return mrf.reject("bridge global exposed")
					end
					return mrf.accept("sandboxed")
				end
			`,
		}, {
			activity: baseActivity,
			actor: {
				uri: 'https://remote.example/users/alice',
				host: 'remote.example',
			},
			localHost: 'local.example',
			signerHost: 'remote.example',
			receivedAt: '2026-06-14T00:00:00.000Z',
		});

		assert.deepStrictEqual(result.decision, {
			action: 'accept',
			reason: 'sandboxed',
		});
	});

	test('times out policies that do not yield', async () => {
		const service = createService();

		await assert.rejects(
			() => service.run({
				id: 'loop',
				name: 'Loop Policy',
				timeoutMs: 20,
				source: `
					function filter(ctx)
						while true do
						end
					end
				`,
			}, {
				activity: baseActivity,
				actor: {
					uri: 'https://remote.example/users/alice',
					host: 'remote.example',
				},
				localHost: 'local.example',
				signerHost: 'remote.example',
				receivedAt: '2026-06-14T00:00:00.000Z',
			}),
			/policy loop failed/i,
		);
	});

	test('times out policy source that does not yield while loading', async () => {
		const service = createService();

		await assert.rejects(
			() => service.extractParamsSchema({
				id: 'load-loop',
				name: 'Load Loop Policy',
				timeoutMs: 20,
				source: `
					while true do
					end
				`,
			}),
			/policy load-loop failed/i,
		);
	});

		test('exposes note helpers for mention counting and removal', async () => {
			const service = createService();
			const activity = {
				...baseActivity,
				object: {
				...baseActivity.object,
				tag: [
					{ type: 'Mention', href: 'https://local.example/@alice' },
					{ type: 'Hashtag', name: '#test' },
					{ type: 'Mention', href: 'https://local.example/@bob' },
				],
			},
		} satisfies IActivity;

		const result = await service.run({
			id: 'helpers',
			name: 'Helper Policy',
			source: `
				function filter(ctx)
					local note = mrf.activity.note(ctx.activity)
					if note == nil then
						return mrf.reject("note missing")
					end
					if mrf.note.mention_count(note) ~= 2 then
						return mrf.reject("wrong mention count")
					end
					mrf.note.remove_mentions(note)
					return mrf.rewrite(ctx.activity, "removed mentions")
				end
			`,
		}, {
			activity,
			actor: {
				uri: 'https://remote.example/users/alice',
				host: 'remote.example',
			},
			localHost: 'local.example',
			signerHost: 'remote.example',
			receivedAt: '2026-06-14T00:00:00.000Z',
		});

		assert.equal(result.decision.action, 'rewrite');
		if (result.decision.action === 'rewrite') {
			assert.deepStrictEqual((result.decision.activity.object as { tag: unknown[] }).tag, [
				{ type: 'Hashtag', name: '#test' },
			]);
			}
		});

		test('remove_mentions keeps an empty tag collection as a JavaScript array', async () => {
			const service = createService();
			const activity = {
				...baseActivity,
				object: {
					...baseActivity.object,
					tag: [
						{ type: 'Mention', href: 'https://local.example/@alice' },
						{ type: 'Mention', href: 'https://local.example/@bob' },
					],
				},
			} satisfies IActivity;

			const result = await service.run({
				id: 'remove-all-mentions',
				name: 'Remove All Mentions Policy',
				source: `
					function filter(ctx)
						local note = mrf.activity.note(ctx.activity)
						mrf.note.remove_mentions(note)
						return mrf.rewrite(ctx.activity, "removed all mentions")
					end
				`,
			}, {
				activity,
				actor: {
					uri: 'https://remote.example/users/alice',
					host: 'remote.example',
				},
				localHost: 'local.example',
				signerHost: 'remote.example',
				receivedAt: '2026-06-14T00:00:00.000Z',
			});

			assert.equal(result.decision.action, 'rewrite');
			if (result.decision.action === 'rewrite') {
				assert.deepStrictEqual((result.decision.activity.object as { tag: unknown[] }).tag, []);
			}
		});

		test('exposes read-only lookup helpers to Lua policies', async () => {
			const service = createService();

			const result = await service.run({
			id: 'lookup',
			name: 'Lookup Policy',
			source: `
				function filter(ctx)
					local user = mrf.lookup.user_by_uri("https://remote.example/users/alice")
					if user == nil or user.followersCount ~= 0 then
						return mrf.reject("lookup failed")
					end
					return mrf.accept("lookup worked")
				end
			`,
		}, {
			activity: baseActivity,
			actor: {
				uri: 'https://remote.example/users/alice',
				host: 'remote.example',
			},
			localHost: 'local.example',
			signerHost: 'remote.example',
			receivedAt: '2026-06-14T00:00:00.000Z',
		}, {
			lookup: {
				userByUri: async () => ({
					uri: 'https://remote.example/users/alice',
					host: 'remote.example',
					followersCount: 0,
					followingCount: 0,
				}),
			},
		});

		assert.deepStrictEqual(result.decision, {
			action: 'accept',
			reason: 'lookup worked',
		});
	});

	test('normalizes lookup null results to Lua nil', async () => {
		const service = createService();

		const result = await service.run({
			id: 'lookup-null',
			name: 'Lookup Null Policy',
			source: `
				function filter(ctx)
					local user = mrf.lookup.user_by_uri("https://remote.example/users/missing")
					if user ~= nil then
						return mrf.reject("lookup miss was not nil")
					end
					return mrf.accept("lookup miss")
				end
			`,
		}, {
			activity: baseActivity,
			actor: {
				uri: 'https://remote.example/users/alice',
				host: 'remote.example',
			},
			localHost: 'local.example',
			signerHost: 'remote.example',
			receivedAt: '2026-06-14T00:00:00.000Z',
		}, {
			lookup: {
				userByUri: async () => null,
			},
		});

		assert.deepStrictEqual(result.decision, {
			action: 'accept',
			reason: 'lookup miss',
		});
	});

	test('exposes a helper for JavaScript null activity fields', async () => {
		const service = createService();

		const result = await service.run({
			id: 'null-helper',
			name: 'Null Helper Policy',
			source: `
				function filter(ctx)
					local note = mrf.activity.note(ctx.activity)
					if note == nil then
						return mrf.reject("note missing")
					end
					if not mrf.is_nil(note.inReplyTo) then
						return mrf.reject("null field was not considered nil")
					end
					return mrf.accept("null helper")
				end
			`,
		}, {
			activity: {
				...baseActivity,
				object: {
					...baseActivity.object,
					inReplyTo: null,
				},
			},
			actor: {
				uri: 'https://remote.example/users/alice',
				host: 'remote.example',
			},
			localHost: 'local.example',
			signerHost: 'remote.example',
			receivedAt: '2026-06-14T00:00:00.000Z',
		});

		assert.deepStrictEqual(result.decision, {
			action: 'accept',
			reason: 'null helper',
		});
	});

	test('extracts policy parameter schema from Lua metadata', async () => {
		const service = createService();

		const schema = await service.extractParamsSchema({
			id: 'params-schema',
			name: 'Params Schema Policy',
			source: `
				policy = {
					params = {
						keywords = {
							type = "string_array",
							default = { "spam", "scam" },
							label = "Blocked keywords",
							description = "Plain substrings to reject",
						},
						caseSensitive = {
							type = "boolean",
							default = true,
						},
					},
				}

				function filter(ctx)
					return mrf.accept()
				end
			`,
		});

		assert.deepStrictEqual(schema, {
			keywords: {
				type: 'string_array',
				default: ['spam', 'scam'],
				label: 'Blocked keywords',
				description: 'Plain substrings to reject',
			},
			caseSensitive: {
				type: 'boolean',
				default: true,
			},
		});
	});

	test('merges parameter defaults and overrides into ctx.params', async () => {
		const service = createService();

		const result = await service.run({
			id: 'params',
			name: 'Params Policy',
			source: `
				policy = {
					params = {
						threshold = {
							type = "integer",
							default = 15,
						},
						keywords = {
							type = "string_array",
							default = { "default" },
						},
					},
				}

				function filter(ctx)
					if ctx.params.threshold ~= 3 then
						return mrf.reject("threshold override missing")
					end
					if ctx.params.keywords[1] ~= "default" then
						return mrf.reject("keyword default missing")
					end
					return mrf.accept("params ok")
				end
			`,
			params: {
				threshold: 3,
			},
		}, {
			activity: baseActivity,
			actor: {
				uri: 'https://remote.example/users/alice',
				host: 'remote.example',
			},
			localHost: 'local.example',
			signerHost: 'remote.example',
			receivedAt: '2026-06-14T00:00:00.000Z',
		});

		assert.deepStrictEqual(result.decision, {
			action: 'accept',
			reason: 'params ok',
		});
	});

	describe('bundled policies', () => {
		test('keyword policy rejects matching note content', async () => {
			const service = createService();
			const keywordPolicy = builtinPolicyFixtures.find(policy => policy.id === 'keyword-filter');
			assert.ok(keywordPolicy);

			const result = await service.run(keywordPolicy, {
				activity: {
					...baseActivity,
					object: {
						...baseActivity.object,
						content: 'join https://discord.gg/ctkpaarr now',
					},
				},
				actor: {
					uri: 'https://remote.example/users/alice',
					host: 'remote.example',
				},
				localHost: 'local.example',
				signerHost: 'remote.example',
				receivedAt: '2026-06-14T00:00:00.000Z',
			});

			assert.equal(result.decision.action, 'reject');
			if (result.decision.action === 'reject') {
				assert.match(result.decision.reason, /keyword/i);
			}
		});

		test('hellthread policy strips mentions at the current threshold', async () => {
			const service = createService();
			const hellthreadPolicy = builtinPolicyFixtures.find(policy => policy.id === 'hellthread');
			assert.ok(hellthreadPolicy);
			const mentions = Array.from({ length: 15 }, (_, i) => ({
				type: 'Mention',
				href: `https://local.example/users/${i}`,
			}));

			const result = await service.run(hellthreadPolicy, {
				activity: {
					...baseActivity,
					object: {
						...baseActivity.object,
						tag: [
							...mentions,
							{ type: 'Hashtag', name: '#kept' },
						],
					},
				},
				actor: {
					uri: 'https://remote.example/users/alice',
					host: 'remote.example',
				},
				localHost: 'local.example',
				signerHost: 'remote.example',
				receivedAt: '2026-06-14T00:00:00.000Z',
			});

			assert.equal(result.decision.action, 'rewrite');
			if (result.decision.action === 'rewrite') {
				assert.deepStrictEqual((result.decision.activity.object as { tag: unknown[] }).tag, [
					{ type: 'Hashtag', name: '#kept' },
				]);
			}
		});

		test('new-user spam policy strips unsolicited local mentions', async () => {
			const service = createService();
			const newUserPolicy = builtinPolicyFixtures.find(policy => policy.id === 'new-user-spam');
			assert.ok(newUserPolicy);

			const result = await service.run(newUserPolicy, {
				activity: {
					...baseActivity,
					object: {
						...baseActivity.object,
						inReplyTo: null,
						tag: [
							{ type: 'Mention', href: 'https://local.example/users/alice' },
							{ type: 'Hashtag', name: '#kept' },
						],
					},
				},
				actor: {
					uri: 'https://remote.example/users/spam',
					host: 'remote.example',
					followersCount: 0,
					followingCount: 0,
				},
				localHost: 'local.example',
				signerHost: 'remote.example',
				receivedAt: '2026-06-14T00:00:00.000Z',
			});

			assert.equal(result.decision.action, 'rewrite');
			if (result.decision.action === 'rewrite') {
				assert.deepStrictEqual((result.decision.activity.object as { tag: unknown[] }).tag, [
					{ type: 'Hashtag', name: '#kept' },
				]);
			}
		});

		test('realistic replay activities exercise bundled rewrite policies', async () => {
			const replayActivities = [
				{
					activity: createHellthreadReplayActivity(),
					actor: {
						uri: 'https://remote.example/users/alice',
						host: 'remote.example',
						followersCount: 12,
						followingCount: 8,
					},
					policyId: 'hellthread',
				},
				{
					activity: createNewUserSpamReplayActivity(),
					actor: {
						uri: 'https://remote.example/users/new',
						host: 'remote.example',
						followersCount: 0,
						followingCount: 0,
					},
					policyId: 'new-user-spam',
				},
			];

			const results = await Promise.all(replayActivities.map(async replay => ({
				...replay,
				result: await runBundledPolicies(replay.activity, replay.actor),
			})));

			for (const replay of results) {
				const rewriteDecision = replay.result.decisions.find(decision => decision.action === 'rewrite');
				assert.equal(rewriteDecision?.policyId, replay.policyId);
				assert.deepStrictEqual((replay.result.activity.object as { tag: unknown[] }).tag, [
					{ type: 'Hashtag', href: 'https://remote.example/tags/kept', name: '#kept' },
				]);
			}
		});
	});
});
