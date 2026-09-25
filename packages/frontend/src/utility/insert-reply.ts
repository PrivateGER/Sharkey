/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';

/**
 * Adds a streamed reply to a reply list in the order the server returns it (newest ID first).
 * Replies fetched from the origin server are often older than the ones already shown, so they can't simply go on top.
 * @returns false if the reply was already listed, e.g. because it was announced twice
 */
export function insertReply(replies: Misskey.entities.Note[], reply: Misskey.entities.Note): boolean {
	if (replies.some(existing => existing.id === reply.id)) return false;

	// Note IDs sort by creation time, and break ties the same way as the server's ORDER BY id.
	const index = replies.findIndex(existing => existing.id < reply.id);
	replies.splice(index === -1 ? replies.length : index, 0, reply);
	return true;
}
