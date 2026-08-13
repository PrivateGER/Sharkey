/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { MiEmojiSuggestion, MiUser } from '@/models/_.js';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type { Packed } from '@/misc/json-schema.js';
import { bindThis } from '@/decorators.js';
import { appendQuery, query } from '@/misc/prelude/url.js';
import { IdService } from '@/core/IdService.js';
import type { UserEntityService } from './UserEntityService.js';

@Injectable()
export class EmojiSuggestionEntityService implements OnModuleInit {
	private userEntityService: UserEntityService;

	constructor(
		private readonly moduleRef: ModuleRef,
		@Inject(DI.config)
		private readonly config: Config,
		private readonly idService: IdService,
	) {
	}

	@bindThis
	public onModuleInit() {
		this.userEntityService = this.moduleRef.get('UserEntityService');
	}

	@bindThis
	public async pack(
		suggestion: MiEmojiSuggestion,
		me: MiUser,
	): Promise<Packed<'EmojiSuggestion'>> {
		const url = suggestion.remoteEmojiUrl == null
			? suggestion.file!.webpublicUrl ?? suggestion.file!.url
			: appendQuery(`${this.config.mediaProxy}/emoji.webp`, query({
				url: suggestion.remoteEmojiUrl,
				emoji: '1',
			}));

		return {
			id: suggestion.id,
			createdAt: this.idService.parse(suggestion.id).date.toISOString(),
			name: suggestion.name,
			category: suggestion.category,
			aliases: suggestion.aliases,
			license: suggestion.license,
			localOnly: suggestion.localOnly,
			isSensitive: suggestion.isSensitive,
			url,
			user: await this.userEntityService.pack(suggestion.user, me, { schema: 'UserLite' }),
		};
	}

	@bindThis
	public async packMany(
		suggestions: MiEmojiSuggestion[],
		me: MiUser,
	): Promise<Packed<'EmojiSuggestion'>[]> {
		return await Promise.all(suggestions.map(suggestion => this.pack(suggestion, me)));
	}
}
