/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import AdminResetPasswordEndpoint from '@/server/api/endpoints/admin/reset-password.js';

describe('admin/reset-password ACL', () => {
	const moderator = { id: 'moderator', username: 'moderator', host: null };
	const admin = { id: 'admin', username: 'admin', host: null };
	const target = { id: 'target', username: 'target', host: null };

	function createEndpoint(options: { callerIsAdmin: boolean; targetIsStaff: boolean }) {
		const usersRepository = {
			findOneBy: jest.fn(async ({ id }: { id: string }) => ({ ...target, id })),
		};
		const userProfilesRepository = {
			update: jest.fn(async () => undefined),
		};
		const roleService = {
			isAdministrator: jest.fn(async () => options.callerIsAdmin),
			isModerator: jest.fn(async () => options.targetIsStaff),
		};
		const moderationLogService = {
			log: jest.fn(async () => undefined),
		};
		const internalEventService = {
			emit: jest.fn(async () => undefined),
		};
		const endpoint = new AdminResetPasswordEndpoint(
			{ rootUserId: 'root' } as any,
			usersRepository as any,
			userProfilesRepository as any,
			moderationLogService as any,
			roleService as any,
			internalEventService as any,
		);

		return { endpoint, usersRepository, userProfilesRepository, roleService };
	}

	test('moderators can reset passwords for regular users', async () => {
		const { endpoint, userProfilesRepository } = createEndpoint({
			callerIsAdmin: false,
			targetIsStaff: false,
		});

		await expect(endpoint.exec({ userId: target.id }, moderator as any, null))
			.resolves.toMatchObject({ password: expect.any(String) });

		expect(userProfilesRepository.update).toHaveBeenCalledWith({ userId: target.id }, {
			password: expect.any(String),
		});
	});

	test('moderators cannot reset staff passwords', async () => {
		const { endpoint, userProfilesRepository } = createEndpoint({
			callerIsAdmin: false,
			targetIsStaff: true,
		});

		await expect(endpoint.exec({ userId: admin.id }, moderator as any, null))
			.rejects.toMatchObject({ code: 'ACCESS_DENIED' });

		expect(userProfilesRepository.update).not.toHaveBeenCalled();
	});

	test('administrators can reset staff passwords', async () => {
		const { endpoint, userProfilesRepository } = createEndpoint({
			callerIsAdmin: true,
			targetIsStaff: true,
		});

		await expect(endpoint.exec({ userId: admin.id }, admin as any, null))
			.resolves.toMatchObject({ password: expect.any(String) });

		expect(userProfilesRepository.update).toHaveBeenCalledWith({ userId: admin.id }, {
			password: expect.any(String),
		});
	});
});
