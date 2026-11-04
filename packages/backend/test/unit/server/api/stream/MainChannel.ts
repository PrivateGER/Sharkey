/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import { MainChannelService } from '@/server/api/stream/channels/main.js';
import type { NoteVisibilityResult } from '@/core/NoteVisibilityService.js';

describe('main channel notifications', () => {
	function setup(visibility: Omit<NoteVisibilityResult, 'redact'>) {
		const subscriber = new EventEmitter();
		const sendMessageToWs = jest.fn(async () => undefined);
		const noteEntityService = {
			noteVisibilityService: {
				checkNoteVisibilityAsync: jest.fn(async () => ({ ...visibility, redact: false })),
			},
			rePack: jest.fn(async (note: unknown) => note),
		};
		const cacheService = {
			getUserRelation: jest.fn(async () => ({ isMuting: false })),
		};
		const connection = {
			user: { id: 'me' },
			subscriber,
			sendMessageToWs,
			userMutedInstances: new Set<string>(),
			userMutedThreads: new Set<string>(),
			userMutedNotes: new Set<string>(),
		};
		// Partial doubles: the channel only touches the members stubbed above.
		const channel = new MainChannelService(noteEntityService as never, cacheService as never).create('main-a', connection as never);

		return {
			channel,
			sendMessageToWs,
			async emitMention() {
				const listeners = subscriber.listeners('mainStream:me') as ((data: unknown) => Promise<void>)[];
				await Promise.all(listeners.map(listener => listener({
					type: 'notification',
					body: {
						id: 'notif-a',
						type: 'mention',
						userId: 'replier',
						user: { id: 'replier', host: null },
						note: { id: 'reply-a', userId: 'replier', replyId: 'someone-elses-note' },
					},
				})));
			},
		};
	}

	// e.g. a mention inside a reply to someone else, from a user the recipient doesn't follow with replies
	test('delivers notifications whose note would be hidden from timelines', async () => {
		const { channel, sendMessageToWs, emitMention } = setup({ accessible: true, silence: true });
		await channel.init();

		await emitMention();

		expect(sendMessageToWs).toHaveBeenCalledWith('channel', expect.objectContaining({
			type: 'notification',
			body: expect.objectContaining({ id: 'notif-a' }),
		}));
	});

	test('drops notifications whose note the recipient cannot access', async () => {
		const { channel, sendMessageToWs, emitMention } = setup({ accessible: false, silence: false });
		await channel.init();

		await emitMention();

		expect(sendMessageToWs).not.toHaveBeenCalled();
	});
});
