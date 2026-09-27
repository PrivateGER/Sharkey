/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { NoteVisibilityService, type NoteVisibilityData, type PopulatedNote } from '@/core/NoteVisibilityService.js';
import type { UserRelation } from '@/core/CacheService.js';

const me = { id: 'me', host: null };

function makeUser(id: string, host: string | null = null): PopulatedNote['user'] {
	return {
		id,
		host,
		isSilenced: false,
		isSuspended: false,
		requireSigninToViewContents: false,
		makeNotesHiddenBefore: null,
		makeNotesFollowersOnlyBefore: null,
	};
}

function makeNote(id: string, user: PopulatedNote['user'], opts: { reply?: PopulatedNote, renote?: PopulatedNote } = {}): PopulatedNote {
	return {
		id,
		threadId: opts.reply?.threadId ?? id,
		userId: user.id,
		userHost: user.host,
		user,
		renoteId: opts.renote?.id ?? null,
		renote: opts.renote ?? null,
		replyId: opts.reply?.id ?? null,
		reply: opts.reply ?? null,
		mentions: [],
		visibleUserIds: [],
		visibility: 'public',
		createdAt: new Date(0),
		text: 'text',
		cw: null,
		hasPoll: false,
		fileIds: [],
	};
}

function makeRelation(targetUserId: string, overrides: Partial<UserRelation> = {}): UserRelation {
	return {
		userId: me.id,
		targetUserId,
		isFollowing: false,
		isFollowed: false,
		isFollowingWithReplies: false,
		isFollowedWithReplies: false,
		isFollowingWithNotifications: false,
		isFollowedWithNotifications: false,
		isMuting: false,
		isMuted: false,
		isMutingRenotes: false,
		isMutedRenotes: false,
		isMutingInstance: false,
		isMutedInstance: false,
		isBlocking: false,
		isBlocked: false,
		memo: null,
		...overrides,
	};
}

function makeData(relations: UserRelation[], overrides: Partial<NoteVisibilityData> = {}): NoteVisibilityData {
	return {
		userMutedThreads: new Set(),
		userMutedNotes: new Set(),
		userMutedInstances: new Set(),
		userRelations: new Map(relations.map(r => [r.targetUserId, r])),
		userListMemberships: new Map(),
		iAmModerator: false,
		...overrides,
	};
}

describe('NoteVisibilityService', () => {
	const service = new NoteVisibilityService(
		null as never,
		null as never,
		null as never,
		null as never,
		{ isBlockedHost: () => false, isSilencedHost: () => false } as never,
		null as never,
	);

	const followed = makeUser('followed');
	const muted = makeUser('muted');
	const other = makeUser('other');

	function silenced(note: PopulatedNote, data: NoteVisibilityData): boolean {
		return service.checkNoteVisibility(note, me, { data, filters: { includeReplies: true } }).silence;
	}

	describe('mutes apply to the content a note points at', () => {
		const relations = [
			makeRelation(followed.id, { isFollowing: true, isFollowingWithReplies: true }),
			makeRelation(muted.id, { isMuting: true }),
			makeRelation(other.id),
		];

		test('a followed user\'s reply to a muted user is silenced', () => {
			const reply = makeNote('reply', followed, { reply: makeNote('target', muted) });

			expect(silenced(reply, makeData(relations))).toBe(true);
		});

		test('a followed user\'s reply to an unmuted user is not silenced', () => {
			const reply = makeNote('reply', followed, { reply: makeNote('target', other) });

			expect(silenced(reply, makeData(relations))).toBe(false);
		});

		test('a followed user\'s quote of a muted user is silenced', () => {
			const quote = makeNote('quote', followed, { renote: makeNote('target', muted) });

			expect(silenced(quote, makeData(relations))).toBe(true);
		});

		test('a followed user\'s quote of a note in a muted thread is silenced', () => {
			const target = makeNote('target', other);
			const quote = makeNote('quote', followed, { renote: target });

			expect(silenced(quote, makeData(relations, { userMutedThreads: new Set([target.threadId]) }))).toBe(true);
		});
	});

	describe('instance mutes apply to reply targets', () => {
		const remote = makeUser('remote', 'muted.example');

		test('a reply to a user on a muted instance is silenced', () => {
			const reply = makeNote('reply', followed, { reply: makeNote('target', remote) });
			const data = makeData([
				makeRelation(followed.id, { isFollowing: true }),
				makeRelation(remote.id),
			], { userMutedInstances: new Set(['muted.example']) });

			expect(silenced(reply, data)).toBe(true);
		});

		test('a reply to a followed user on a muted instance is not silenced', () => {
			const reply = makeNote('reply', followed, { reply: makeNote('target', remote) });
			const data = makeData([
				makeRelation(followed.id, { isFollowing: true }),
				makeRelation(remote.id, { isFollowing: true }),
			], { userMutedInstances: new Set(['muted.example']) });

			expect(silenced(reply, data)).toBe(false);
		});
	});
});
