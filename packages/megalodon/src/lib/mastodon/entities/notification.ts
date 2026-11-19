import type { Account } from './account.js';
import type { Status } from './status.js';

export interface Notification {
	account: Account
	created_at: string
	id: string
	status?: Status
	type: NotificationType
	// What a reaction was made with. Not in Mastodon itself, but read by apps that know reactions.
	emoji?: string
	emoji_url?: string
}

export type NotificationType = string
