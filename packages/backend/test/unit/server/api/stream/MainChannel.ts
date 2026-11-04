/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import { MainChannelService } from '@/server/api/stream/channels/main.js';
import { NoteVisibilityService, type PopulatedNote } from '@/core/NoteVisibilityService.js';
import type { UserRelation } from '@/core/CacheService.js';

const me = { id: 'me', host: null };

function makeUser(id: string, opts: { isSilenced?: boolean } = {}): PopulatedNote['user'] {
	return {
		id,
		host: null,
		isSilenced: opts.isSilenced ?? false,
		isSuspended: false,
		requireSigninToViewContents: false,
		makeNotesHiddenBefore: null,
		makeNotesFollowersOnlyBefore: null,
	};
}

type TestNote = {
	id: string;
	userId: string;
	user: PopulatedNote['user'];
	threadId: string;
	replyId: string | null;
	reply: TestNote | null;
	renoteId: null;
	renote: null;
	visibility: 'public' | 'followers';
	mentions: string[];
	visibleUserIds: string[];
	createdAt: string;
	text: string;
	cw: null;
	fileIds: string[];
	hasPoll: boolean;
};

function makeNote(id: string, user: PopulatedNote['user'], opts: { reply?: TestNote, visibility?: TestNote['visibility'], mentions?: string[] } = {}): TestNote {
	return {
		id,
		userId: user.id,
		user,
		threadId: opts.reply?.threadId ?? id,
		replyId: opts.reply?.id ?? null,
		reply: opts.reply ?? null,
		renoteId: null,
		renote: null,
		visibility: opts.visibility ?? 'public',
		mentions: opts.mentions ?? [],
		visibleUserIds: [],
		createdAt: new Date(0).toISOString(),
		text: 'text',
		cw: null,
		fileIds: [],
		hasPoll: false,
	};
}

function relation(targetUserId: string): UserRelation {
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
	};
}

describe('main channel notifications', () => {
	async function deliver(notification: { type: string, userId: string, note: TestNote }, mutes: { notes?: string[], threads?: string[] } = {}) {
		const subscriber = new EventEmitter();
		const sendMessageToWs = jest.fn(async () => undefined);
		const cacheService = {
			getUserRelation: jest.fn(async (_me: string, target: string) => relation(target)),
			getUserRelations: jest.fn(async (_me: unknown, targets: string[]) => new Map(targets.map(t => [t, relation(t)]))),
		};
		// Partial doubles: only the members used by these code paths are provided.
		const noteVisibilityService = new NoteVisibilityService(
			null as never,
			cacheService as never,
			null as never,
			null as never,
			{ isBlockedHost: () => false, isSilencedHost: () => false } as never,
			{ isModerator: async () => false } as never,
		);
		const noteEntityService = {
			noteVisibilityService,
			rePack: jest.fn(async (note: unknown) => note),
		};
		const connection = {
			user: me,
			subscriber,
			sendMessageToWs,
			userMutedInstances: new Set<string>(),
			userMutedThreads: new Set<string>(mutes.threads),
			userMutedNotes: new Set<string>(mutes.notes),
		};
		const channel = new MainChannelService(noteEntityService as never, cacheService as never).create('main-a', connection as never);
		await channel.init();

		const listeners = subscriber.listeners('mainStream:me') as ((data: unknown) => Promise<void>)[];
		await Promise.all(listeners.map(listener => listener({
			type: 'notification',
			body: { id: 'notif-a', user: { id: notification.userId, host: null }, ...notification },
		})));

		return sendMessageToWs.mock.calls.length > 0;
	}

	test('delivers a mention inside a reply to someone else, from an author not followed with replies', async () => {
		const parent = makeNote('parent', makeUser('kanako'));
		const reply = makeNote('reply', makeUser('ayano'), { reply: parent, mentions: [me.id] });

		expect(await deliver({ type: 'mention', userId: 'ayano', note: reply })).toBe(true);
	});

	test('delivers a mention from a silenced author', async () => {
		const note = makeNote('loud', makeUser('loud', { isSilenced: true }), { mentions: [me.id] });

		expect(await deliver({ type: 'mention', userId: 'loud', note })).toBe(true);
	});

	test('drops a reaction notification on a muted note', async () => {
		const note = makeNote('mine', makeUser(me.id));

		expect(await deliver({ type: 'reaction', userId: 'ayano', note }, { notes: ['mine'] })).toBe(false);
	});

	test('drops a notification in a muted thread', async () => {
		const note = makeNote('mine', makeUser(me.id));

		expect(await deliver({ type: 'reaction', userId: 'ayano', note }, { threads: ['mine'] })).toBe(false);
	});

	test('drops a notification whose note the recipient cannot access', async () => {
		const note = makeNote('fo', makeUser('ayano'), { visibility: 'followers' });

		expect(await deliver({ type: 'renote', userId: 'ayano', note })).toBe(false);
	});
});
