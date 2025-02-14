/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MegalodonInterface } from 'megalodon';
import type { FastifyRequest } from 'fastify';

const readScope = [
	'read:account',
	'read:drive',
	'read:blocks',
	'read:favorites',
	'read:following',
	'read:messaging',
	'read:mutes',
	'read:notifications',
	'read:reactions',
	'read:pages',
	'read:page-likes',
	'read:user-groups',
	'read:channels',
	'read:gallery',
	'read:gallery-likes',
];

const writeScope = [
	'write:account',
	'write:drive',
	'write:blocks',
	'write:favorites',
	'write:following',
	'write:messaging',
	'write:mutes',
	'write:notes',
	'write:notifications',
	'write:reactions',
	'write:votes',
	'write:pages',
	'write:page-likes',
	'write:user-groups',
	'write:channels',
	'write:gallery',
	'write:gallery-likes',
];

export interface AuthPayload {
	scopes?: string | string[],
	redirect_uris?: string,
	client_name?: string,
	website?: string,
}

// Not entirely right, but it gets TypeScript to work so *shrug*
export type AuthMastodonRoute = { Body?: AuthPayload, Querystring: AuthPayload };

export async function ApiAuthMastodon(request: FastifyRequest<AuthMastodonRoute>, client: MegalodonInterface) {
	const body = request.body ?? request.query;
	if (!body.scopes) throw new Error('Missing required payload "scopes"');
	if (!body.redirect_uris) throw new Error('Missing required payload "redirect_uris"');
	if (!body.client_name) throw new Error('Missing required payload "client_name"');

	let scope = body.scopes;
	if (typeof scope === 'string') {
		scope = scope.split(/[ +]/g);
	}

	const pushScope = new Set<string>();
	for (const s of scope) {
		if (s.match(/^read/)) {
			for (const r of readScope) {
				pushScope.add(r);
			}
		}
		if (s.match(/^write/)) {
			for (const r of writeScope) {
				pushScope.add(r);
			}
		}
	}

	const red = body.redirect_uris;
	const appData = await client.registerApp(body.client_name, {
		scopes: Array.from(pushScope),
		redirect_uris: red,
		website: body.website,
	});

	return {
		id: Math.floor(Math.random() * 100).toString(),
		name: appData.name,
		website: body.website,
		redirect_uri: red,
		client_id: Buffer.from(appData.url || '').toString('base64'), // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing
		client_secret: appData.clientSecret,
	};
}
