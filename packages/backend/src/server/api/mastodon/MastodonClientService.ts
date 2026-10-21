/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Misskey } from 'megalodon';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { MiLocalUser } from '@/models/User.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';
import type { FastifyRequest } from 'fastify';

@Injectable()
export class MastodonClientService {
	constructor(
		@Inject(DI.config)
		private readonly config: Config,

		private readonly authenticateService: AuthenticateService,
	) {}

	/**
	 * Gets the authenticated user and API client for a request.
	 */
	public async getAuthClient(request: FastifyRequest, accessToken?: string | null): Promise<{ client: Misskey, me: MiLocalUser | null }> {
		const authorization = request.headers.authorization;
		accessToken = accessToken !== undefined ? accessToken : getAccessToken(authorization);

		const me = await this.getAuth(request, accessToken);
		const client = this.getClient(request, accessToken);

		return { client, me };
	}

	/**
	 * Gets the authenticated client user for a request.
	 */
	public async getAuth(request: FastifyRequest, accessToken?: string | null): Promise<MiLocalUser | null> {
		const authorization = request.headers.authorization;
		accessToken = accessToken !== undefined ? accessToken : getAccessToken(authorization);
		const [me] = await this.authenticateService.authenticate(accessToken);
		return me;
	}

	/**
	 * Creates an authenticated API client for a request.
	 */
	public getClient(request: FastifyRequest, accessToken?: string | null): Misskey {
		const authorization = request.headers.authorization;
		accessToken = accessToken !== undefined ? accessToken : getAccessToken(authorization);

		// TODO pass agent?
		const baseUrl = this.getBaseUrl();
		const userAgent = request.headers['user-agent'];
		return new Misskey(baseUrl, accessToken, userAgent);
	}

	/**
	 * Gets the base URL (origin) that server-side requests back into this instance's API should use.
	 * This is deliberately taken from the configuration and not from the incoming request: with `trustProxy`
	 * enabled, `request.host` comes from the client-controlled `X-Forwarded-Host` header, which would let a
	 * caller point these internal requests at arbitrary hosts (SSRF).
	 */
	public getBaseUrl(): string {
		return this.config.url;
	}
}

/**
 * Gets the base URL (origin) of the incoming request, as seen by the client.
 * Only use this to build URLs that are sent back to the client (e.g. pagination links) - never for requests
 * made by the server, since `request.host` is client-controlled when running behind a trusted proxy.
 */
export function getRequestBaseUrl(request: FastifyRequest): string {
	return `${request.protocol}://${request.host}`;
}

/**
 * Extracts the first access token from an authorization header
 * Returns null if none were found.
 */
function getAccessToken(authorization: string | undefined): string | null {
	const accessTokenArr = authorization?.split(' ') ?? [null];
	return accessTokenArr[accessTokenArr.length - 1];
}
