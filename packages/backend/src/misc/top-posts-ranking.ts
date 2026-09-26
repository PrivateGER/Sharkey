/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const hour = 1000 * 60 * 60;

// Engagement points = renoters * renote + repliers * reply + reactors * reaction.
// These must match the points column of top_interesting_posts_for_local_users.
export const engagementWeights = {
	renote: 3,
	reply: 2,
	reaction: 1,
} as const;

// Dampens huge posts so they don't sit on top for two days.
const pointsExponent = 0.75;
// How quickly posts fall off: score / (hoursOld + ageOffset) ^ gravity
const gravity = 0.8;
const ageOffsetHours = 2;
// Personal factor = 1 + (following the author) + (people you follow who engaged, capped)
const followingAuthorBoost = 0.5;
const followedEngagerBoost = 0.25;
const maxFollowedEngagers = 4;

export const maxPostsPerAuthor = 2;

export type TopPostCandidate = {
	noteId: string;
	authorId: string;
	createdAt: number;
	renoters: number;
	repliers: number;
	reactors: number;
	engagers: number;
	isFollowingAuthor: boolean;
	followedEngagers: number;
};

export type TopPostScoreExplanation = {
	total_score: number;
	formula: string;
	components: {
		engagement: {
			points: number;
			people: number;
			renotes: { count: number; weight: number; contribution: number };
			replies: { count: number; weight: number; contribution: number };
			reactions: { count: number; weight: number; contribution: number };
		};
		recency: {
			hours_old: number;
			factor: number;
			formula: string;
		};
		personal: {
			factor: number;
			is_following_author: boolean;
			following_boost: number;
			followed_engagers: number;
			followed_engagers_boost: number;
		};
	};
};

export type RankedTopPost = {
	noteId: string;
	score: number;
	scoreExplanation: TopPostScoreExplanation;
};

export function scoreTopPost(candidate: TopPostCandidate, now: number): RankedTopPost {
	const renotes = candidate.renoters * engagementWeights.renote;
	const replies = candidate.repliers * engagementWeights.reply;
	const reactions = candidate.reactors * engagementWeights.reaction;
	const points = renotes + replies + reactions;

	const hoursOld = Math.max(now - candidate.createdAt, 0) / hour;
	const recencyFactor = 1 / Math.pow(hoursOld + ageOffsetHours, gravity);

	const followingBoost = candidate.isFollowingAuthor ? followingAuthorBoost : 0;
	const followedEngagersBoost = Math.min(candidate.followedEngagers, maxFollowedEngagers) * followedEngagerBoost;
	const personalFactor = 1 + followingBoost + followedEngagersBoost;

	const score = Math.pow(points, pointsExponent) * recencyFactor * personalFactor;

	return {
		noteId: candidate.noteId,
		score,
		scoreExplanation: {
			total_score: score,
			formula: `engagement_points^${pointsExponent} × recency_factor × personal_factor`,
			components: {
				engagement: {
					points,
					people: candidate.engagers,
					renotes: { count: candidate.renoters, weight: engagementWeights.renote, contribution: renotes },
					replies: { count: candidate.repliers, weight: engagementWeights.reply, contribution: replies },
					reactions: { count: candidate.reactors, weight: engagementWeights.reaction, contribution: reactions },
				},
				recency: {
					hours_old: hoursOld,
					factor: recencyFactor,
					formula: `1 / (hours_old + ${ageOffsetHours})^${gravity}`,
				},
				personal: {
					factor: personalFactor,
					is_following_author: candidate.isFollowingAuthor,
					following_boost: followingBoost,
					followed_engagers: candidate.followedEngagers,
					followed_engagers_boost: followedEngagersBoost,
				},
			},
		},
	};
}

/**
 * Scores the candidates and returns the best ones, with at most {@link maxPostsPerAuthor} posts by the same author.
 */
export function rankTopPosts(candidates: TopPostCandidate[], now: number, limit: number): RankedTopPost[] {
	const scored = candidates
		.map(candidate => ({ authorId: candidate.authorId, ranked: scoreTopPost(candidate, now) }))
		.sort((a, b) => b.ranked.score - a.ranked.score);

	const postsPerAuthor = new Map<string, number>();
	const result: RankedTopPost[] = [];
	for (const { authorId, ranked } of scored) {
		if (result.length >= limit) break;

		const count = postsPerAuthor.get(authorId) ?? 0;
		if (count >= maxPostsPerAuthor) continue;
		postsPerAuthor.set(authorId, count + 1);

		result.push(ranked);
	}

	return result;
}
