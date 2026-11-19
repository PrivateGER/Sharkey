/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import axios, { AxiosError } from 'axios';
import { Misskey } from 'megalodon';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { MiLocalUser } from '@/models/User.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';
import type { AxiosAdapter, RawAxiosResponseHeaders } from 'axios';
import type { FastifyRequest, InjectOptions } from 'fastify';

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

		const baseUrl = this.getBaseUrl();
		const userAgent = request.headers['user-agent'];
		return new Misskey(baseUrl, accessToken, userAgent, createInProcessAdapter(request));
	}

	/**
	 * Gets the base URL (origin) of this instance, which megalodon uses to build links and to address the native API.
	 * This is deliberately taken from the configuration and not from the incoming request: with `trustProxy`
	 * enabled, `request.host` comes from the client-controlled `X-Forwarded-Host` header.
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

/**
 * Makes megalodon's requests to the native API reach this server's own router directly, without a network connection.
 * The native API sees the address of the original client, so its rate limits apply to that client.
 */
function createInProcessAdapter(request: FastifyRequest): AxiosAdapter {
	return async config => {
		const url = new URL(axios.getUri(config));

		const headers: Record<string, string> = {};
		for (const [name, value] of Object.entries(config.headers.toJSON())) {
			if (value != null) headers[name.toLowerCase()] = String(value);
		}

		let payload: string | Buffer | undefined = config.data;
		if (config.data instanceof FormData) {
			// The multipart boundary is only known once the form is encoded.
			const encoded = new Response(config.data);
			headers['content-type'] = encoded.headers.get('content-type') ?? 'multipart/form-data';
			payload = Buffer.from(await encoded.arrayBuffer());
		}

		const res = await request.server.inject({
			method: (config.method ?? 'get').toUpperCase() as InjectOptions['method'],
			url: url.pathname + url.search,
			headers,
			payload,
			remoteAddress: request.ip,
		});

		const response = {
			data: res.payload,
			status: res.statusCode,
			statusText: res.statusMessage,
			headers: res.headers as RawAxiosResponseHeaders,
			config,
		};

		if (!config.validateStatus || config.validateStatus(res.statusCode)) {
			return response;
		}

		throw new AxiosError(
			`Request failed with status code ${res.statusCode}`,
			res.statusCode >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
			config,
			null,
			response,
		);
	};
}
