/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { TopPostsOptimize1746304875484 } from './1746304875484-OptimizeTopPosts.js';

// Replaces the per-user ranking with one global list of candidate posts.
// Time decay and personalisation are applied at request time by the top-posts endpoint,
// so the view only holds stats that don't go stale between refreshes.
// The name is kept so existing REFRESH jobs (e.g. pg_cron) keep working.
export class TopPostsCandidates1790400000000 {
	name = 'TopPostsCandidates1790400000000'

	async up(queryRunner) {
		await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS top_interesting_posts_for_local_users`);
		await queryRunner.query(`
			CREATE MATERIALIZED VIEW top_interesting_posts_for_local_users AS
			WITH candidates AS (
				SELECT n.id, n."userId", n.created_at
				FROM note n
				JOIN "user" u ON u.id = n."userId"
				LEFT JOIN instance i ON i.host = n."userHost"
				WHERE n.created_at >= NOW() - INTERVAL '48 hours'
					AND n.visibility = 'public'
					-- Top-level posts only: replies lack context, pure renotes are duplicates
					AND n."replyId" IS NULL
					AND (n."renoteId" IS NULL OR n.text IS NOT NULL OR n."hasPoll" OR cardinality(n."fileIds") > 0)
					AND NOT u."isSuspended"
					AND NOT u."isDeleted"
					AND NOT u."isSilenced"
					AND NOT u."isBot"
					AND u."isExplorable"
					AND (i.host IS NULL OR (i."suspensionState" = 'none' AND NOT i."isBlocked" AND NOT i."isSilenced"))
			),
			engagements AS (
				SELECT r."noteId" AS note_id, r."userId" AS user_id, 'reaction' AS kind
				FROM note_reaction r
				JOIN candidates c ON c.id = r."noteId"
				WHERE r."userId" <> c."userId"
				UNION ALL
				SELECT n."renoteId", n."userId", 'renote'
				FROM note n
				JOIN candidates c ON c.id = n."renoteId"
				WHERE n."userId" <> c."userId"
				UNION ALL
				SELECT n."replyId", n."userId", 'reply'
				FROM note n
				JOIN candidates c ON c.id = n."replyId"
				WHERE n."userId" <> c."userId"
			),
			stats AS (
				-- Count people, not events, and ignore accounts that can't be trusted to vote
				SELECT
					e.note_id,
					count(DISTINCT e.user_id) FILTER (WHERE e.kind = 'renote') AS renoters,
					count(DISTINCT e.user_id) FILTER (WHERE e.kind = 'reply') AS repliers,
					count(DISTINCT e.user_id) FILTER (WHERE e.kind = 'reaction') AS reactors,
					count(DISTINCT e.user_id) AS engagers,
					array_agg(DISTINCT e.user_id) AS engager_ids
				FROM engagements e
				JOIN "user" u ON u.id = e.user_id
				WHERE NOT u."isSuspended" AND NOT u."isDeleted" AND NOT u."isSilenced" AND NOT u."isBot"
				GROUP BY e.note_id
			)
			SELECT
				c.id AS post_id,
				c."userId" AS author_id,
				s.renoters::int AS renoters,
				s.repliers::int AS repliers,
				s.reactors::int AS reactors,
				s.engagers::int AS engagers,
				(3 * s.renoters + 2 * s.repliers + s.reactors)::int AS points,
				s.engager_ids
			FROM candidates c
			JOIN stats s ON s.note_id = c.id
			-- A single like is not a signal
			WHERE s.engagers >= 2
			ORDER BY (3 * s.renoters + 2 * s.repliers + s.reactors) / power(EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600 + 2, 0.8) DESC
			LIMIT 1000
		`);
		// Allows REFRESH MATERIALIZED VIEW CONCURRENTLY
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_top_interesting_posts_post_id" ON top_interesting_posts_for_local_users (post_id)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS top_interesting_posts_for_local_users`);
		await new TopPostsOptimize1746304875484().up(queryRunner);
	}
}
