/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { rankTopPosts, scoreTopPost, type TopPostCandidate } from '@/misc/top-posts-ranking.js';

const hour = 1000 * 60 * 60;
const now = Date.UTC(2026, 0, 1, 12);

function candidate(noteId: string, hoursOld: number, stats: Partial<TopPostCandidate> = {}): TopPostCandidate {
	return {
		noteId,
		authorId: `author-${noteId}`,
		createdAt: now - hoursOld * hour,
		renoters: 0,
		repliers: 0,
		reactors: 0,
		engagers: 0,
		isFollowingAuthor: false,
		followedEngagers: 0,
		...stats,
	};
}

describe(scoreTopPost, () => {
	it('should weigh renotes over replies over reactions', () => {
		const renoted = scoreTopPost(candidate('a', 1, { renoters: 2, engagers: 2 }), now);
		const replied = scoreTopPost(candidate('b', 1, { repliers: 2, engagers: 2 }), now);
		const reacted = scoreTopPost(candidate('c', 1, { reactors: 2, engagers: 2 }), now);

		expect(renoted.score).toBeGreaterThan(replied.score);
		expect(replied.score).toBeGreaterThan(reacted.score);
		expect(renoted.scoreExplanation.components.engagement.points).toBe(6);
	});

	it('should rank a well-liked older post above a barely-liked new one', () => {
		const older = scoreTopPost(candidate('a', 12, { reactors: 40, renoters: 3, engagers: 43 }), now);
		const fresh = scoreTopPost(candidate('b', 0, { reactors: 2, engagers: 2 }), now);

		expect(older.score).toBeGreaterThan(fresh.score);
	});

	it('should prefer the newer post when engagement is equal', () => {
		const older = scoreTopPost(candidate('a', 20, { reactors: 10, engagers: 10 }), now);
		const newer = scoreTopPost(candidate('b', 2, { reactors: 10, engagers: 10 }), now);

		expect(newer.score).toBeGreaterThan(older.score);
	});

	it('should boost posts by followed authors and posts that followed people engaged with', () => {
		const base = scoreTopPost(candidate('a', 1, { reactors: 5, engagers: 5 }), now);
		const followed = scoreTopPost(candidate('a', 1, { reactors: 5, engagers: 5, isFollowingAuthor: true }), now);
		const social = scoreTopPost(candidate('a', 1, { reactors: 5, engagers: 5, followedEngagers: 2 }), now);

		expect(followed.score).toBeCloseTo(base.score * 1.5);
		expect(social.score).toBeCloseTo(base.score * 1.5);
	});

	it('should cap the boost from followed people', () => {
		const some = scoreTopPost(candidate('a', 1, { reactors: 50, engagers: 50, followedEngagers: 4 }), now);
		const many = scoreTopPost(candidate('a', 1, { reactors: 50, engagers: 50, followedEngagers: 40 }), now);

		expect(many.score).toBe(some.score);
	});

	it('should not reward posts dated in the future', () => {
		const future = scoreTopPost(candidate('a', -5, { reactors: 5, engagers: 5 }), now);
		const current = scoreTopPost(candidate('a', 0, { reactors: 5, engagers: 5 }), now);

		expect(future.score).toBe(current.score);
	});
});

describe(rankTopPosts, () => {
	it('should sort by score and respect the limit', () => {
		const result = rankTopPosts([
			candidate('low', 1, { reactors: 2, engagers: 2 }),
			candidate('high', 1, { reactors: 20, engagers: 20 }),
			candidate('mid', 1, { reactors: 8, engagers: 8 }),
		], now, 2);

		expect(result.map(post => post.noteId)).toEqual(['high', 'mid']);
	});

	it('should show at most two posts per author', () => {
		const result = rankTopPosts([
			candidate('a1', 1, { authorId: 'a', reactors: 30, engagers: 30 }),
			candidate('a2', 1, { authorId: 'a', reactors: 20, engagers: 20 }),
			candidate('a3', 1, { authorId: 'a', reactors: 10, engagers: 10 }),
			candidate('b1', 1, { authorId: 'b', reactors: 5, engagers: 5 }),
		], now, 10);

		expect(result.map(post => post.noteId)).toEqual(['a1', 'a2', 'b1']);
	});
});
