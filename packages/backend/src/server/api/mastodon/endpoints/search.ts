/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MiLocalUser } from '@/models/User.js';
import { MastoConverters } from '../converters.js';
import { parseTimelineArgs, TimelineArgs } from '../timelineArgs.js';
import Account = Entity.Account;
import Status = Entity.Status;
import type { MegalodonInterface } from 'megalodon';
import type { FastifyRequest } from 'fastify';

export interface ApiSearchMastodonRoute {
	Querystring: TimelineArgs & {
		type?: 'accounts' | 'hashtags' | 'statuses';
		q?: string;
	}
}

export class ApiSearchMastodon {
	constructor(
		private readonly request: FastifyRequest<ApiSearchMastodonRoute>,
		private readonly client: MegalodonInterface,
		private readonly me: MiLocalUser | null,
		private readonly BASE_URL: string,
		private readonly mastoConverters: MastoConverters,
	) {}

	public async SearchV1() {
		if (!this.request.query.q) throw new Error('Missing required property "q"');
		const query = parseTimelineArgs(this.request.query);
		const data = await this.client.search(this.request.query.q, { type: this.request.query.type, ...query });
		return data.data;
	}

	public async SearchV2() {
		if (!this.request.query.q) throw new Error('Missing required property "q"');
		const query = parseTimelineArgs(this.request.query);
		const type = this.request.query.type;
		const acct = !type || type === 'accounts' ? await this.client.search(this.request.query.q, { type: 'accounts', ...query }) : null;
		const stat = !type || type === 'statuses' ? await this.client.search(this.request.query.q, { type: 'statuses', ...query }) : null;
		const tags = !type || type === 'hashtags' ? await this.client.search(this.request.query.q, { type: 'hashtags', ...query }) : null;
		return {
			accounts: await Promise.all(acct?.data.accounts.map(async (account: Account) => await this.mastoConverters.convertAccount(account)) ?? []),
			statuses: await Promise.all(stat?.data.statuses.map(async (status: Status) => await this.mastoConverters.convertStatus(status, this.me)) ?? []),
			hashtags: tags?.data.hashtags ?? [],
		};
	}

	public async getStatusTrends() {
		const data = await fetch(`${this.BASE_URL}/api/notes/featured`,
			{
				method: 'POST',
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					i: this.request.headers.authorization?.replace('Bearer ', ''),
				}),
			})
			.then(res => res.json() as Promise<Status[]>)
			.then(data => data.map(status => this.mastoConverters.convertStatus(status, this.me)));
		return Promise.all(data);
	}

	public async getSuggestions() {
		const data = await fetch(`${this.BASE_URL}/api/users`,
			{
				method: 'POST',
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					i: this.request.headers.authorization?.replace('Bearer ', ''),
					limit: parseTimelineArgs(this.request.query).limit ?? 20,
					origin: 'local',
					sort: '+follower',
					state: 'alive',
				}),
			})
			.then(res => res.json() as Promise<Account[]>)
			.then(data => data.map((entry => ({
				source: 'global',
				account: entry,
			}))));
		return Promise.all(data.map(async suggestion => {
			suggestion.account = await this.mastoConverters.convertAccount(suggestion.account);
			return suggestion;
		}));
	}
}
