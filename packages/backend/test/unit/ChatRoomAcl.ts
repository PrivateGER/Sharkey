/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import { ChatRoomChannelService } from '@/server/api/stream/channels/chat-room.js';
import ChatRoomsShowEndpoint from '@/server/api/endpoints/chat/rooms/show.js';

describe('chat room ACLs', () => {
	test('chatRoom stream does not subscribe non-members to room events', async () => {
		const room = { id: 'rooma', ownerId: 'owner' };
		const subscriber = new EventEmitter();
		const sendMessageToWs = jest.fn();
		const chatRoomsRepository = {
			findOne: jest.fn(async () => room),
		};
		const chatService = {
			checkChatAvailability: jest.fn(async () => undefined),
			hasPermissionToViewRoomTimeline: jest.fn(async () => false),
			readRoomChatMessage: jest.fn(async () => undefined),
		};
		const connection = {
			user: { id: 'not-member' },
			subscriber,
			sendMessageToWs,
		};
		const channel = new ChatRoomChannelService(
			chatRoomsRepository as any,
			chatService as any,
		).create('channel-a', connection as any);

		await expect(channel.init({ roomId: room.id })).resolves.toBe(true);

		expect(chatService.hasPermissionToViewRoomTimeline).toHaveBeenCalledWith(connection.user, room);
		expect(subscriber.listenerCount(`chatRoomStream:${room.id}`)).toBe(0);

		subscriber.emit(`chatRoomStream:${room.id}`, {
			type: 'message',
			body: { id: 'message-a', text: 'secret' },
		});

		expect(sendMessageToWs).not.toHaveBeenCalled();
	});

	test('chat/rooms/show hides rooms from users without room timeline access', async () => {
		const room = { id: 'rooma', ownerId: 'owner' };
		const chatService = {
			checkChatAvailability: jest.fn(async () => undefined),
			findRoomById: jest.fn(async () => room),
			hasPermissionToViewRoomTimeline: jest.fn(async () => false),
		};
		const chatEntityService = {
			packRoom: jest.fn(async () => ({ id: room.id, name: 'secret room' })),
		};
		const endpoint = new ChatRoomsShowEndpoint(
			chatService as any,
			chatEntityService as any,
		);

		await expect(endpoint.exec({ roomId: room.id }, { id: 'not-member' } as any, null))
			.rejects.toMatchObject({ code: 'NO_SUCH_ROOM' });

		expect(chatEntityService.packRoom).not.toHaveBeenCalled();
	});
});
