/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest } from '@jest/globals';
import { AuthenticationError } from '@/server/api/AuthenticateService.js';
import { MastodonClientService } from '@/server/api/mastodon/MastodonClientService.js';

describe('MastodonClientService', () => {
	const users: Record<string, { id: string }> = {
		'token-a': { id: 'user-a' },
		'token-b': { id: 'user-b' },
	};
	const authenticate = jest.fn(async (token: string | null) => {
		if (token == null) return [null, null];
		if (!(token in users)) throw new AuthenticationError('invalid signature');
		return [users[token], null];
	});
	const service = new MastodonClientService(
		{ url: 'https://example.com' } as never,
		{ authenticate } as never,
	);

	function createRequest(token: string) {
		return { headers: { authorization: `Bearer ${token}` } } as never;
	}

	beforeEach(() => {
		authenticate.mockClear();
	});

	it('should look a request\'s token up once, however often it is asked', async () => {
		const request = createRequest('token-a');

		const me = await service.getAuth(request);
		const { me: meAgain } = await service.getAuthClient(request);

		expect(me).toEqual({ id: 'user-a' });
		expect(meAgain).toEqual({ id: 'user-a' });
		expect(authenticate).toHaveBeenCalledTimes(1);
	});

	it('should keep rejecting a bad token', async () => {
		const request = createRequest('token-x');

		await expect(service.getAuth(request)).rejects.toBeInstanceOf(AuthenticationError);
		await expect(service.getAuthClient(request)).rejects.toBeInstanceOf(AuthenticationError);
	});

	it('should not share a result between requests', async () => {
		const first = await service.getAuth(createRequest('token-a'));
		const second = await service.getAuth(createRequest('token-b'));

		expect(first).toEqual({ id: 'user-a' });
		expect(second).toEqual({ id: 'user-b' });
	});
});
