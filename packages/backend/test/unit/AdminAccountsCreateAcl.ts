/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import AdminAccountsCreateEndpoint from '@/server/api/endpoints/admin/accounts/create.js';

describe('admin/accounts/create ACL', () => {
	const admin = { id: 'admin', username: 'admin', host: null };
	const token = {
		permission: ['write:admin:account', 'write:admin:approve-user'],
		rank: 'user',
	};

	function createEndpoint(isAdministrator: boolean) {
		const usersRepository = {
			findOneByOrFail: jest.fn(async () => ({ ...admin })),
		};
		const roleService = {
			isAdministrator: jest.fn(async () => isAdministrator),
		};
		const signupService = {
			signup: jest.fn(async () => ({
				account: { id: 'created', username: 'created', host: null },
				secret: 'native-token',
			})),
		};
		const userEntityService = {
			pack: jest.fn(async () => ({ id: 'created' })),
		};
		const endpoint = new AdminAccountsCreateEndpoint(
			{ setupPassword: null } as any,
			{ rootUserId: 'root' } as any,
			usersRepository as any,
			roleService as any,
			userEntityService as any,
			signupService as any,
			{ log: jest.fn(async () => undefined) } as any,
		);

		return { endpoint, usersRepository, roleService, signupService };
	}

	test('uses authenticated caller metadata for admin checks', async () => {
		const { endpoint, usersRepository, roleService, signupService } = createEndpoint(false);

		await expect(endpoint.exec({
			username: 'created',
			password: 'password',
			setupPassword: null,
		}, admin as any, token as any)).rejects.toMatchObject({ code: 'ROLE_PERMISSION_DENIED' });

		expect(usersRepository.findOneByOrFail).not.toHaveBeenCalled();
		expect(roleService.isAdministrator).toHaveBeenCalledWith(admin);
		expect(signupService.signup).not.toHaveBeenCalled();
	});

	test('allows unrestricted administrator tokens with required permissions', async () => {
		const { endpoint, signupService } = createEndpoint(true);

		await expect(endpoint.exec({
			username: 'created',
			password: 'password',
			setupPassword: null,
		}, admin as any, {
			...token,
			rank: 'admin',
		} as any)).resolves.toMatchObject({
			id: 'created',
			token: 'native-token',
		});

		expect(signupService.signup).toHaveBeenCalled();
	});
});
