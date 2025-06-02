/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApResolverService } from '@/core/activitypub/ApResolverService.js';
import { isCollectionOrOrderedCollection, isOrderedCollection, isOrderedCollectionPage } from '@/core/activitypub/type.js';

export const meta = {
	tags: ['federation'],

	requireAdmin: true,
	requireCredential: true,
	kind: 'read:federation',

	limit: {
		duration: ms('1hour'),
		max: 30,
	},

	errors: {
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		uri: { type: 'string' },
		expandCollectionItems: { type: 'boolean' },
		expandCollectionLimit: { type: 'integer', nullable: true },
		allowAnonymous: { type: 'boolean' },
	},
	required: ['uri'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private apResolverService: ApResolverService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const resolver = this.apResolverService.createResolver();
			const object = await resolver.resolve(ps.uri, ps.allowAnonymous ?? false);

			if (ps.expandCollectionItems && isCollectionOrOrderedCollection(object)) {
				const items = await resolver.resolveCollectionItems(object, ps.expandCollectionLimit, ps.allowAnonymous ?? false);

				if (isOrderedCollection(object) || isOrderedCollectionPage(object)) {
					object.orderedItems = items;
				} else {
					object.items = items;
				}
			}

			return object;
		});
	}
}
