/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MastodonEntity } from 'megalodon';
import { parseTimelineArgs, TimelineArgs } from '@/server/api/mastodon/argsUtils.js';
import { MastodonConverters } from '@/server/api/mastodon/MastodonConverters.js';
import { attachMinMaxPagination } from '@/server/api/mastodon/pagination.js';
import { promiseMap } from '@/misc/promise-map.js';
import { MastodonClientService } from '../MastodonClientService.js';
import type { FastifyInstance } from 'fastify';

interface ApiNotifyMastodonRoute {
	Querystring: TimelineArgs,
}

@Injectable()
export class ApiNotificationsMastodon {
	constructor(
		private readonly mastoConverters: MastodonConverters,
		private readonly clientService: MastodonClientService,
	) {}

	public register(fastify: FastifyInstance): void {
		fastify.get<ApiNotifyMastodonRoute>('/v1/notifications', async (request, reply) => {
			const { client, me } = await this.clientService.getAuthClient(request);
			const data = await client.getNotifications(parseTimelineArgs(request.query));
			const notifications = await promiseMap(data.data, async n => await this.mastoConverters.convertNotification(n, me), { limiter: 4 });
			const response: MastodonEntity.Notification[] = [];
			for (const notification of notifications) {
				// Notifications for inaccessible notes will be null and should be ignored
				if (!notification) continue;

				response.push(notification);
				if (notification.type === 'reaction') {
					response.push({
						...notification,
						type: 'favourite',
					});
				}
			}

			attachMinMaxPagination(request, reply, response);
			return reply.send(response);
		});

		fastify.post<ApiNotifyMastodonRoute>('/v1/notifications/clear', async (_request, reply) => {
			const client = this.clientService.getClient(_request);
			const data = await client.dismissNotifications();

			return reply.send(data.data);
		});
	}
}
