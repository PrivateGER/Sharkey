/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { parseTimelineArgs, TimelineArgs } from '@/server/api/mastodon/timelineArgs.js';
import { MiLocalUser } from '@/models/User.js';
import { MastoConverters, convertRelationship } from '../converters.js';
import type { MegalodonInterface } from 'megalodon';
import type { FastifyRequest } from 'fastify';

export interface ApiAccountMastodonRoute {
	Params: { id?: string },
	Querystring: TimelineArgs & { acct?: string },
	Body: { notifications?: boolean }
}

@Injectable()
export class ApiAccountMastodon {
	constructor(
		private readonly request: FastifyRequest<ApiAccountMastodonRoute>,
		private readonly client: MegalodonInterface,
		private readonly me: MiLocalUser | null,
		private readonly mastoConverters: MastoConverters,
	) {}

	public async verifyCredentials() {
		const data = await this.client.verifyAccountCredentials();
		const acct = await this.mastoConverters.convertAccount(data.data);
		return Object.assign({}, acct, {
			source: {
				note: acct.note,
				fields: acct.fields,
				privacy: '',
				sensitive: false,
				language: '',
			},
		});
	}

	public async lookup() {
		if (!this.request.query.acct) throw new Error('Missing required property "acct"');
		const data = await this.client.search(this.request.query.acct, { type: 'accounts' });
		return this.mastoConverters.convertAccount(data.data.accounts[0]);
	}

	public async getRelationships(reqIds: string[]) {
		const data = await this.client.getRelationships(reqIds);
		return data.data.map(relationship => convertRelationship(relationship));
	}

	public async getStatuses() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.getAccountStatuses(this.request.params.id, parseTimelineArgs(this.request.query));
		return await Promise.all(data.data.map(async (status) => await this.mastoConverters.convertStatus(status, this.me)));
	}

	public async getFollowers() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.getAccountFollowers(
			this.request.params.id,
			parseTimelineArgs(this.request.query),
		);
		return await Promise.all(data.data.map(async (account) => await this.mastoConverters.convertAccount(account)));
	}

	public async getFollowing() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.getAccountFollowing(
			this.request.params.id,
			parseTimelineArgs(this.request.query),
		);
		return await Promise.all(data.data.map(async (account) => await this.mastoConverters.convertAccount(account)));
	}

	public async addFollow() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.followAccount(this.request.params.id);
		const acct = convertRelationship(data.data);
		acct.following = true;
		return acct;
	}

	public async rmFollow() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.unfollowAccount(this.request.params.id);
		const acct = convertRelationship(data.data);
		acct.following = false;
		return acct;
	}

	public async addBlock() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.blockAccount(this.request.params.id);
		return convertRelationship(data.data);
	}

	public async rmBlock() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.unblockAccount(this.request.params.id);
		return convertRelationship(data.data);
	}

	public async addMute() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.muteAccount(
			this.request.params.id,
			this.request.body.notifications ?? true,
		);
		return convertRelationship(data.data);
	}

	public async rmMute() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.unmuteAccount(this.request.params.id);
		return convertRelationship(data.data);
	}

	public async getBookmarks() {
		const data = await this.client.getBookmarks(parseTimelineArgs(this.request.query));
		return Promise.all(data.data.map((status) => this.mastoConverters.convertStatus(status, this.me)));
	}

	public async getFavourites() {
		const data = await this.client.getFavourites(parseTimelineArgs(this.request.query));
		return Promise.all(data.data.map((status) => this.mastoConverters.convertStatus(status, this.me)));
	}

	public async getMutes() {
		const data = await this.client.getMutes(parseTimelineArgs(this.request.query));
		return Promise.all(data.data.map((account) => this.mastoConverters.convertAccount(account)));
	}

	public async getBlocks() {
		const data = await this.client.getBlocks(parseTimelineArgs(this.request.query));
		return Promise.all(data.data.map((account) => this.mastoConverters.convertAccount(account)));
	}

	public async acceptFollow() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.acceptFollowRequest(this.request.params.id);
		return convertRelationship(data.data);
	}

	public async rejectFollow() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.rejectFollowRequest(this.request.params.id);
		return convertRelationship(data.data);
	}
}
