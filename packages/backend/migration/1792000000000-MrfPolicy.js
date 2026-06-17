/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class MrfPolicy1792000000000 {
	name = 'MrfPolicy1792000000000'

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "mrf_policy" ("id" character varying(32) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(256) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "priority" integer NOT NULL DEFAULT '1000', "source" text NOT NULL, "timeoutMs" integer NOT NULL DEFAULT '50', "failureMode" character varying(32) NOT NULL DEFAULT 'reject', "isBuiltin" boolean NOT NULL DEFAULT false, "builtinPolicyId" character varying(128), "paramsSchema" jsonb NOT NULL DEFAULT '{}', "params" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_mrf_policy" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE INDEX "IDX_mrf_policy_enabled_priority" ON "mrf_policy" ("enabled", "priority")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_mrf_policy_builtinPolicyId" ON "mrf_policy" ("builtinPolicyId")`);
		await queryRunner.query(`INSERT INTO "mrf_policy" ("id", "name", "enabled", "priority", "source", "timeoutMs", "failureMode", "isBuiltin", "builtinPolicyId", "paramsSchema", "params") VALUES ($1, $2, true, 10, $3, 50, 'reject', true, $4, $5::jsonb, $6::jsonb)`, [
			'mrfbuiltinnewuserspam001',
			'New user spam mention filter',
			`
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
			'new-user-spam',
			JSON.stringify({
				maxFollowers: {
					type: 'integer',
					default: 0,
					label: 'Maximum followers',
				},
				maxFollowing: {
					type: 'integer',
					default: 0,
					label: 'Maximum following',
				},
				onlyTopLevelPosts: {
					type: 'boolean',
					default: true,
					label: 'Only top-level posts',
				},
			}),
			'{}',
		]);
		await queryRunner.query(`INSERT INTO "mrf_policy" ("id", "name", "enabled", "priority", "source", "timeoutMs", "failureMode", "isBuiltin", "builtinPolicyId", "paramsSchema", "params") VALUES ($1, $2, true, 20, $3, 50, 'reject', true, $4, $5::jsonb, $6::jsonb)`, [
			'mrfbuiltinhellthread001',
			'Hellthread mention filter',
			`
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
			'hellthread',
			JSON.stringify({
				mentionThreshold: {
					type: 'integer',
					default: 15,
					label: 'Mention threshold',
				},
			}),
			'{}',
		]);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "IDX_mrf_policy_builtinPolicyId"`);
		await queryRunner.query(`DROP INDEX "IDX_mrf_policy_enabled_priority"`);
		await queryRunner.query(`DROP TABLE "mrf_policy"`);
	}
}
