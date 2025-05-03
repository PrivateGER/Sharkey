export class TopPostsOptimize1746304875484{
	name = 'TopPostsOptimize1746304875484'

	async up(queryRunner) {
		await queryRunner.query(`
					DROP MATERIALIZED VIEW IF EXISTS top_interesting_posts_for_local_users;

					CREATE MATERIALIZED VIEW top_interesting_posts_for_local_users AS
			WITH local_users AS (
					SELECT id, username
					FROM public.user
					WHERE host IS NULL AND NOT "isSuspended" AND NOT "isDeleted"
			),
			-- Pre-filter and pre-calculate engagement metrics once
					 posts_with_engagement AS (
							 SELECT
									 n.id AS post_id,
									 n."userId" AS author_id,
									 n.text,
									 n.cw,
									 n.created_at,
									 n."renoteCount",
									 n."repliesCount",
									 -- Calculate reaction count once and materialize it
									 (SELECT COALESCE(SUM(value::int), 0) FROM jsonb_each_text(n.reactions)) AS reaction_count,
									 -- Calculate hours old for recency
									 EXTRACT(EPOCH FROM (NOW() - n.created_at)) / 3600 AS hours_old,
									 -- Calculate base engagement score
									 (n."renoteCount" * 2) + n."repliesCount" +
									 (SELECT COALESCE(SUM(value::int), 0) FROM jsonb_each_text(n.reactions)) AS engagement_score
							 FROM note n
												JOIN public.user u ON n."userId" = u.id
							 WHERE
									 n.created_at >= NOW() - INTERVAL '24 hours'
								 AND n.visibility = 'public'
								 AND NOT (u."isSuspended" OR u."isDeleted")
								 -- Only include posts with at least one interaction
								 AND (
									 n."renoteCount" > 0
											 OR n."repliesCount" > 0
											 OR (SELECT COALESCE(SUM(value::int), 0) FROM jsonb_each_text(n.reactions)) > 0
									 )
					 ),
			-- Add author details
					 posts_with_author AS (
							 SELECT
									 p.*,
									 au.username AS author_username,
									 -- Calculate recency factor here
									 (24 / (p.hours_old + 1)) AS recency_factor,
									 -- Multiply engagement by recency for base score
									 p.engagement_score * (24 / (p.hours_old + 1)) AS base_score
							 FROM posts_with_engagement p
												JOIN public.user au ON p.author_id = au.id
					 ),
			-- Now calculate user-specific scores and rank
					 user_rankings AS (
							 SELECT
									 u.id AS user_id,
									 u.username AS user_username,
									 p.post_id,
									 p.author_id,
									 p.author_username,
									 p.text,
									 p.cw,
									 p.created_at,
									 p.engagement_score,
									 -- Following boost only if the user follows the author
									 CASE WHEN f."followeeId" IS NOT NULL THEN 10 ELSE 0 END AS following_boost,
									 -- Final score = base_score + following_boost
									 p.base_score + CASE WHEN f."followeeId" IS NOT NULL THEN 10 ELSE 0 END AS total_score,
									 -- Score explanation JSON
									 jsonb_build_object(
													 'total_score', p.base_score + CASE WHEN f."followeeId" IS NOT NULL THEN 10 ELSE 0 END,
													 'components', jsonb_build_object(
																	 'engagement', jsonb_build_object(
																	 'score', p.engagement_score,
																	 'renotes', jsonb_build_object(
																					 'count', p."renoteCount",
																					 'weight', 2,
																					 'contribution', p."renoteCount" * 2
																							),
																	 'replies', jsonb_build_object(
																					 'count', p."repliesCount",
																					 'weight', 1,
																					 'contribution', p."repliesCount"
																							),
																	 'reactions', jsonb_build_object(
																					 'count', p.reaction_count,
																					 'weight', 1,
																					 'contribution', p.reaction_count
																								)
																								 ),
																	 'recency', jsonb_build_object(
																					 'hours_old', p.hours_old,
																					 'factor', p.recency_factor,
																					 'formula', '24 / (hours_old + 1)'
																							),
																	 'following', jsonb_build_object(
																					 'is_following', f."followeeId" IS NOT NULL,
																					 'boost', CASE WHEN f."followeeId" IS NOT NULL THEN 10 ELSE 0 END
																								)
																				 ),
													 'formula', 'engagement_score * recency_factor + following_boost'
									 ) AS score_explanation,
									 -- Rank posts by total score for each user
									 ROW_NUMBER() OVER (
											 PARTITION BY u.id
											 ORDER BY (p.base_score + CASE WHEN f."followeeId" IS NOT NULL THEN 10 ELSE 0 END) DESC
											 ) AS rank
							 FROM local_users u
												-- Using a lateral join to limit to top candidates before the cross join expansion
												CROSS JOIN LATERAL (
									 SELECT * FROM posts_with_author
									 ORDER BY base_score DESC
									 LIMIT 500  -- Pre-filter to top 500 posts by engagement before cross join
									 ) p
												LEFT JOIN public.following f ON u.id = f."followerId" AND p.author_id = f."followeeId"
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
			FROM user_rankings
			WHERE rank <= 25  -- Top 25 posts per user
			ORDER BY user_id, rank;
		`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS top_interesting_posts_for_local_users`);
	}
}
