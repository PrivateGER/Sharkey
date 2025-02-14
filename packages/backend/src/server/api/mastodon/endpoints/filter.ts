/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { toBoolean } from '@/server/api/mastodon/timelineArgs.js';
import { convertFilter } from '../converters.js';
import type { MegalodonInterface } from 'megalodon';
import type { FastifyRequest } from 'fastify';

export interface ApiFilterMastodonRoute {
	Params: {
		id?: string,
	},
	Body: {
		phrase?: string,
		context?: string[],
		irreversible?: string,
		whole_word?: string,
		expires_in?: string,
	}
}

export class ApiFilterMastodon {
	constructor(
		private readonly request: FastifyRequest<ApiFilterMastodonRoute>,
		private readonly client: MegalodonInterface,
	) {}

	public async getFilters() {
		const data = await this.client.getFilters();
		return data.data.map((filter) => convertFilter(filter));
	}

	public async getFilter() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.getFilter(this.request.params.id);
		return convertFilter(data.data);
	}

	public async createFilter() {
		if (!this.request.body.phrase) throw new Error('Missing required payload "phrase"');
		if (!this.request.body.context) throw new Error('Missing required payload "context"');
		const options = {
			phrase: this.request.body.phrase,
			context: this.request.body.context,
			irreversible: toBoolean(this.request.body.irreversible),
			whole_word: toBoolean(this.request.body.whole_word),
			expires_in: this.request.body.expires_in,
		};
		const data = await this.client.createFilter(this.request.body.phrase, this.request.body.context, options);
		return convertFilter(data.data);
	}

	public async updateFilter() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		if (!this.request.body.phrase) throw new Error('Missing required payload "phrase"');
		if (!this.request.body.context) throw new Error('Missing required payload "context"');
		const options = {
			phrase: this.request.body.phrase,
			context: this.request.body.context,
			irreversible: toBoolean(this.request.body.irreversible),
			whole_word: toBoolean(this.request.body.whole_word),
			expires_in: this.request.body.expires_in,
		};
		const data = await this.client.updateFilter(this.request.params.id, this.request.body.phrase, this.request.body.context, options);
		return convertFilter(data.data);
	}

	public async rmFilter() {
		if (!this.request.params.id) throw new Error('Missing required parameter "id"');
		const data = await this.client.deleteFilter(this.request.params.id);
		return data.data;
	}
}
