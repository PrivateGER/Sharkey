/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import Xev from 'xev';
import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { isJsonObject } from '@/misc/json-value.js';
import type { JsonObject, JsonValue } from '@/misc/json-value.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import Channel, { type MiChannelService } from '../channel.js';

const ev = new Xev();

class QueueStatsChannel extends Channel {
	public readonly chName = 'queueStats';
	public static shouldShare = true;
	public static requireCredential = false as const;

	constructor(id: string, connection: Channel['connection'], noteEntityService: NoteEntityService) {
		super(id, connection, noteEntityService);
		//this.onStats = this.onStats.bind(this);
		//this.onMessage = this.onMessage.bind(this);
	}

	@bindThis
	public async init(params: JsonObject) {
		ev.addListener('queueStats', this.onStats);
	}

	@bindThis
	private onStats(stats: JsonObject) {
		this.send('stats', stats);
	}

	@bindThis
	public onMessage(type: string, body: JsonValue) {
		switch (type) {
			case 'requestLog':
				if (!isJsonObject(body)) return;
				if (typeof body.id !== 'string') return;
				if (typeof body.length !== 'number') return;
				ev.once(`queueStatsLog:${body.id}`, statsLog => {
					this.send('statsLog', statsLog);
				});
				ev.emit('requestQueueStatsLog', {
					id: body.id,
					length: body.length,
				});
				break;
		}
	}

	@bindThis
	public dispose() {
		ev.removeListener('queueStats', this.onStats);
	}
}

@Injectable()
export class QueueStatsChannelService implements MiChannelService<false> {
	public readonly shouldShare = QueueStatsChannel.shouldShare;
	public readonly requireCredential = QueueStatsChannel.requireCredential;
	public readonly kind = QueueStatsChannel.kind;

	constructor(
		private readonly noteEntityService: NoteEntityService,
	) {
	}

	@bindThis
	public create(id: string, connection: Channel['connection']): QueueStatsChannel {
		return new QueueStatsChannel(
			id,
			connection,
			this.noteEntityService,
		);
	}
}
