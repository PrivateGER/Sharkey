/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { bindThis } from '@/decorators.js';
import { deepClone } from '@/misc/clone.js';
import type { Packed } from '@/misc/json-schema.js';
import type { JsonObject, JsonValue } from '@/misc/json-value.js';
import type Connection from '@/server/api/stream/Connection.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';

/**
 * Stream channel
 */
export abstract class Channel {
	protected connection: Connection;
	public id: string;
	public abstract readonly chName: string;
	public static readonly shouldShare: boolean;
	public static readonly requireCredential: boolean;
	public static readonly kind?: string | null;

	protected get user() {
		return this.connection.user;
	}

	protected get userProfile() {
		return this.connection.userProfile;
	}

	protected get cacheService() {
		return this.connection.cacheService;
	}

	/**
	 * @deprecated use cacheService.userFollowingsCache to avoid stale data
	 */
	protected get following() {
		return this.connection.following;
	}

	/**
	 * TODO use onChange to keep these in sync?
	 * @deprecated use cacheService.userMutingsCache to avoid stale data
	 */
	protected get userIdsWhoMeMuting() {
		return this.connection.userIdsWhoMeMuting;
	}

	/**
	 * @deprecated use cacheService.renoteMutingsCache to avoid stale data
	 */
	protected get userIdsWhoMeMutingRenotes() {
		return this.connection.userIdsWhoMeMutingRenotes;
	}

	/**
	 * @deprecated use cacheService.userBlockedCache to avoid stale data
	 */
	protected get userIdsWhoBlockingMe() {
		return this.connection.userIdsWhoBlockingMe;
	}

	/**
	 * @deprecated use cacheService.threadMutingsCache to avoid stale data
	 */
	protected get userMutedInstances() {
		return this.connection.userMutedInstances;
	}

	/**
	 * @deprecated use cacheService.threadMutingsCache to avoid stale data
	 */
	protected get userMutedThreads() {
		return this.connection.userMutedThreads;
	}

	/**
	 * @deprecated use cacheService.noteMutingsCache to avoid stale data
	 */
	protected get userMutedNotes() {
		return this.connection.userMutedNotes;
	}

	/**
	 * @deprecated use cacheService.threadMutingsCache to avoid stale data
	 */
	protected get followingChannels() {
		return this.connection.followingChannels;
	}

	protected get subscriber() {
		return this.connection.subscriber;
	}

	protected get myRecentReactions() {
		return this.connection.myRecentReactions;
	}

	protected get myRecentRenotes() {
		return this.connection.myRecentRenotes;
	}

	protected get myRecentFavorites() {
		return this.connection.myRecentFavorites;
	}

	constructor(id: string, connection: Connection) {
		this.id = id;
		this.connection = connection;
	}

	public send(payload: { type: string, body: JsonValue }): void;
	public send(type: string, payload: JsonValue): void;
	@bindThis
	public send(typeOrPayload: { type: string, body: JsonValue } | string, payload?: JsonValue) {
		const type = payload === undefined ? (typeOrPayload as { type: string, body: JsonValue }).type : (typeOrPayload as string);
		const body = payload === undefined ? (typeOrPayload as { type: string, body: JsonValue }).body : payload;

		this.connection.sendMessageToWs('channel', {
			id: this.id,
			type: type,
			body: body,
		});
	}

	public abstract init(params: JsonObject): void | Promise<void> | Promise<boolean>;

	public dispose?(): void;

	public onMessage?(type: string, body: JsonValue): void;
}

// For compatability with old code
// eslint-disable-next-line import/no-default-export
export default Channel;

export abstract class NoteChannel extends Channel {
	protected constructor(
		id: string,
		connection: Connection,
		protected readonly noteEntityService: NoteEntityService,
	) {
		super(id, connection);
	}

	protected get noteVisibilityService() {
		return this.noteEntityService.noteVisibilityService;
	}

	public async rePackNote(note: Packed<'Note'>): Promise<Packed<'Note'>> {
		// If there's no user, then packing won't change anything.
		// We can just re-use the original note.
		if (!this.user) {
			return note;
		}

		// StreamingApiServerService creates a single EventEmitter per server process,
		// so a new note arriving from redis gets de-serialised once per server process,
		// and then that single object is passed to all active channels on each connection.
		// If we didn't clone the notes here, different connections would asynchronously write
		// different values to the same object, resulting in a random value being sent to each frontend. -- Dakkar
		const clonedNote = deepClone(note);

		// Hide notes before everything else, since this modifies fields that the other functions will check.
		const notes = crawl(clonedNote);

		const [myReactions, myRenotes, myFavorites, myThreadMutings, myNoteMutings, myFollowings] = await Promise.all([
			this.noteEntityService.populateMyReactions(notes, this.user.id, {
				myReactions: this.myRecentReactions,
			}),
			this.noteEntityService.populateMyRenotes(notes, this.user.id, {
				myRenotes: this.myRecentRenotes,
			}),
			this.noteEntityService.populateMyFavorites(notes, this.user.id, {
				myFavorites: this.myRecentFavorites,
			}),
			this.noteEntityService.populateMyTheadMutings(notes, this.user.id),
			this.noteEntityService.populateMyNoteMutings(notes, this.user.id),
			this.cacheService.userFollowingsCache.fetch(this.user.id),
		]);

		for (const n of notes) {
			// Sync visibility in case there's something like "makeNotesFollowersOnlyBefore" enabled
			this.noteVisibilityService.syncVisibility(n);

			n.myReaction = myReactions.get(n.id) ?? null;
			n.isRenoted = myRenotes.has(n.id);
			n.isFavorited = myFavorites.has(n.id);
			n.isMutingThread = myThreadMutings.has(n.id);
			n.isMutingNote = myNoteMutings.has(n.id);
			n.user.bypassSilence = n.userId === this.user.id || myFollowings.has(n.userId);
		}

		// Hide notes *after* we sync visibility
		await this.noteEntityService.hideNotes(notes, this.user.id, {
			userFollowings: myFollowings,
		});

		return clonedNote;
	}

	/**
	 * Prepares a note before it gets sent to the client.
	 * @returns A packed note, or `null` if the note shouldn't be seen by the user
	 * who owns this connection, for whatever reason.
	 */
	protected async prepareNote(note: Packed<'Note'>): Promise<Packed<'Note'> | null> {
		const { accessible, silence } = await this.noteVisibilityService.checkNoteVisibilityAsync(note, this.user);

		// Skip notes that the user can't or shouldn't access
		if (!accessible || silence) {
			return null;
		}

		// Include everything else, but make sure to re-pack it for the user's context!
		return await this.rePackNote(note);
	}
}

export type MiChannelService<T extends boolean> = {
	shouldShare: boolean;
	requireCredential: T;
	kind: T extends true ? string : string | null | undefined;
	create: (id: string, connection: Connection) => Channel;
};

function crawl(note: Packed<'Note'>, into?: Packed<'Note'>[]): Packed<'Note'>[] {
	into ??= [];

	if (!into.includes(note)) {
		into.push(note);
	}

	if (note.reply) {
		crawl(note.reply, into);
	}

	if (note.renote) {
		crawl(note.renote, into);
	}

	return into;
}
