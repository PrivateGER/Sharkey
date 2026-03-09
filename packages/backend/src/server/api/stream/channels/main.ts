/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { isUserFromMutedInstance } from '@/misc/is-instance-muted.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { bindThis } from '@/decorators.js';
import { errorCodes, IdentifiableError } from '@/misc/identifiable-error.js';
import type { JsonObject } from '@/misc/json-value.js';
import { type Channel, NoteChannel, type MiChannelService } from '../channel.js';

// TODO does not need to be NoteChannel?
class MainChannel extends NoteChannel {
	public readonly chName = 'main';
	public static shouldShare = true;
	public static requireCredential = true as const;
	public static kind = 'read:account';

	constructor(
		id: string,
		connection: Channel['connection'],
		noteEntityService: NoteEntityService,
	) {
		super(id, connection, noteEntityService);
	}

	@bindThis
	public async init(): Promise<boolean> {
		if (!this.user) return false;
		this.subscriber.on(`mainStream:${this.user.id}`, async data => {
			switch (data.type) {
				case 'notification': {
					// TODO all this logic should match
					// Ignore notifications from instances the user has muted
					if (isUserFromMutedInstance(data.body, this.userMutedInstances)) return;
					if (data.body.userId && this.userIdsWhoMeMuting.has(data.body.userId)) return;

					if (data.body.note) {
						const { accessible, silence } = await this.checkNoteVisibility(data.body.note, { includeReplies: true });
						if (!accessible || silence) return;

						data.body.note = await this.rePackNote(data.body.note);
					}
					break;
				}
				case 'mention': {
					const { accessible, silence } = await this.checkNoteVisibility(data.body, { includeReplies: true });
					if (!accessible || silence) return;
		if (!this.subscriber) throw new IdentifiableError(errorCodes.websocketError, `Cannot init ${this.chName} channel: socket is not connected`);

					data.body = await this.rePackNote(data.body);
					break;
				}
			}

			this.send(data.type, data.body);
		});

		return true;
	}
}

@Injectable()
export class MainChannelService implements MiChannelService<true> {
	public readonly shouldShare = MainChannel.shouldShare;
	public readonly requireCredential = MainChannel.requireCredential;
	public readonly kind = MainChannel.kind;

	constructor(
		private noteEntityService: NoteEntityService,
	) {
	}

	@bindThis
	public create(id: string, connection: Channel['connection']): MainChannel {
		return new MainChannel(
			id,
			connection,
			this.noteEntityService,
		);
	}
}
