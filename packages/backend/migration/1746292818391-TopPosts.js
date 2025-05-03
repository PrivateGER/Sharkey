export class TopPosts1746292818391 {
	name = 'TopPosts1746292818391'

	async up(queryRunner) {
		await queryRunner.query(`
		CREATE MATERIALIZED VIEW top_interesting_posts_for_local_users AS
		WITH local_users AS (
				SELECT id, username
				FROM public.user
				WHERE host IS NULL AND NOT "isSuspended" AND NOT "isDeleted"
		),
				 recent_public_posts AS (
						 SELECT
								 n.*,
								 -- Calculate time-based recency factor
								 EXTRACT(EPOCH FROM (NOW() - n.created_at)) / 3600 AS hours_old,
								 -- Calculate reaction count from the JSONB
								 (
										 SELECT COALESCE(SUM(value::int), 0)
										 FROM jsonb_each_text(n.reactions) AS r(key, value)
								 ) AS reaction_count,
								 -- Base engagement score
								 (n."renoteCount" * 2) + n."repliesCount" + (
										 SELECT COALESCE(SUM(value::int), 0)
										 FROM jsonb_each_text(n.reactions) AS r(key, value)
								 ) AS engagement_score
						 FROM note n
											JOIN public.user u ON n."userId" = u.id
						 WHERE
								 n.created_at >= NOW() - INTERVAL '24 hours'
							 AND n."replyId" IS NULL
							 AND n.visibility = 'public'  -- Only public posts
							 AND NOT (u."isSuspended" OR u."isDeleted")
				 ),
				 user_interesting_posts AS (
						 SELECT
								 u.id AS user_id,
								 u.username AS user_username,
								 rp.id AS post_id,
								 rp."userId" AS author_id,
								 au.username AS author_username,
								 rp.text,
								 rp.cw,
								 rp.created_at,
								 rp.hours_old,
								 rp."renoteCount",
								 rp."repliesCount",
								 rp.reaction_count,
								 rp.engagement_score,
								 -- Recency factor
								 (24 / (rp.hours_old + 1)) AS recency_factor,
								 -- Boost score for followed users
								 CASE WHEN f."followeeId" IS NOT NULL THEN 10 ELSE 0 END AS following_boost,
								 -- Final score calculation with recency decay
								 (rp.engagement_score * (24 / (rp.hours_old + 1))) +
								 CASE WHEN f."followeeId" IS NOT NULL THEN 10 ELSE 0 END AS total_score,
								 -- Create score explanation JSON
								 jsonb_build_object(
												 'total_score', (rp.engagement_score * (24 / (rp.hours_old + 1))) +
																				CASE WHEN f."followeeId" IS NOT NULL THEN 10 ELSE 0 END,
												 'components', jsonb_build_object(
																 'engagement', jsonb_build_object(
																 'score', rp.engagement_score,
																 'renotes', jsonb_build_object(
																				 'count', rp."renoteCount",
																				 'weight', 2,
																				 'contribution', rp."renoteCount" * 2
																						),
																 'replies', jsonb_build_object(
																				 'count', rp."repliesCount",
																				 'weight', 1,
																				 'contribution', rp."repliesCount"
																						),
																 'reactions', jsonb_build_object(
																				 'count', rp.reaction_count,
																				 'weight', 1,
																				 'contribution', rp.reaction_count
																							)
																							 ),
																 'recency', jsonb_build_object(
																				 'hours_old', rp.hours_old,
																				 'factor', (24 / (rp.hours_old + 1)),
																				 'formula', '24 / (hours_old + 1)'
																						),
																 'following', jsonb_build_object(
																				 'is_following', f."followeeId" IS NOT NULL,
																				 'boost', CASE WHEN f."followeeId" IS NOT NULL THEN 10 ELSE 0 END
																							)
																			 ),
												 'formula', 'engagement_score * recency_factor + following_boost'
								 ) AS score_explanation,
								 -- Rank posts by score for each user
								 ROW_NUMBER() OVER (
										 PARTITION BY u.id
										 ORDER BY
												 (rp.engagement_score * (24 / (rp.hours_old + 1))) +
												 CASE WHEN f."followeeId" IS NOT NULL THEN 10 ELSE 0 END DESC
										 ) AS rank
						 FROM local_users u
											CROSS JOIN recent_public_posts rp
											JOIN public.user au ON rp."userId" = au.id
											LEFT JOIN public.following f ON u.id = f."followerId" AND rp."userId" = f."followeeId"
				 )
			SELECT
					user_id,
					user_username,
					post_id,
					author_id,
					author_username,
					text,
					cw,
					created_at,
					engagement_score,
					following_boost,
					total_score,
					score_explanation,
					rank
			FROM user_interesting_posts
			WHERE rank <= 25
		`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS top_interesting_posts_for_local_users`);
	}
}
