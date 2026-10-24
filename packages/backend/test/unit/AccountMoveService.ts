/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { Test } from '@nestjs/testing';
import { In } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import type { TestingModule } from '@nestjs/testing';
import { GlobalModule } from '@/GlobalModule.js';
import { CoreModule } from '@/core/CoreModule.js';
import { DI } from '@/di-symbols.js';
import { AccountMoveService } from '@/core/AccountMoveService.js';
import { CacheService } from '@/core/CacheService.js';
import { IdService } from '@/core/IdService.js';
import { CacheManagementService } from '@/global/CacheManagementService.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import type { MiUser, RenoteMutingsRepository, UsersRepository } from '@/models/_.js';

describe('AccountMoveService', () => {
	let app: TestingModule;
	let accountMoveService: AccountMoveService;
	let cacheService: CacheService;
	let idService: IdService;
	let usersRepository: UsersRepository;
	let renoteMutingsRepository: RenoteMutingsRepository;
	let cacheManagementService: CacheManagementService;
	const createdUserIds: string[] = [];

	async function createUser(): Promise<MiUser> {
		const username = secureRndstr(16);
		const inserted = await usersRepository.insert({
			id: idService.gen(),
			username,
			usernameLower: username.toLowerCase(),
		});
		const user = await usersRepository.findOneByOrFail(inserted.identifiers[0]);
		createdUserIds.push(user.id);
		return user;
	}

	beforeAll(async () => {
		// These tests check that cached relationships are updated, so they need the real caches with their real lifetimes.
		app = await Test
			.createTestingModule({
				imports: [
					GlobalModule,
					CoreModule,
				],
			})
			.compile();

		await app.init();
		app.enableShutdownHooks();

		accountMoveService = app.get(AccountMoveService);
		cacheService = app.get(CacheService);
		idService = app.get(IdService);
		usersRepository = app.get<UsersRepository>(DI.usersRepository);
		renoteMutingsRepository = app.get<RenoteMutingsRepository>(DI.renoteMutingsRepository);
		cacheManagementService = app.get(CacheManagementService);
	});

	afterAll(async () => {
		await app.close();
	});

	afterEach(async () => {
		await cacheManagementService.clear();
		if (createdUserIds.length > 0) {
			await renoteMutingsRepository.delete([
				{ muterId: In(createdUserIds) },
				{ muteeId: In(createdUserIds) },
			]);
			await usersRepository.delete({ id: In(createdUserIds) });
			createdUserIds.length = 0;
		}
	});

	describe('copyRenoteMutings', () => {
		test('copies renote mutes to the destination and updates cached relationships at once', async () => {
			const [src, dst, muter] = await Promise.all([createUser(), createUser(), createUser()]);
			await renoteMutingsRepository.insert({ id: idService.gen(), muterId: muter.id, muteeId: src.id });

			// Prime the relationship cache the way a timeline or profile request would.
			expect((await cacheService.getUserRelation(muter.id, dst.id)).isMutingRenotes).toBe(false);
			expect((await cacheService.getUserRelation(dst.id, muter.id)).isMutedRenotes).toBe(false);

			await accountMoveService.copyRenoteMutings(src, dst);

			expect(await renoteMutingsRepository.existsBy({ muterId: muter.id, muteeId: dst.id })).toBe(true);
			// Without the cache update these would stay false until the cached relationship expires.
			expect((await cacheService.getUserRelation(muter.id, dst.id)).isMutingRenotes).toBe(true);
			expect((await cacheService.getUserRelation(dst.id, muter.id)).isMutedRenotes).toBe(true);
		});

		test('does not duplicate a renote mute that already targets the destination', async () => {
			const [src, dst, muter] = await Promise.all([createUser(), createUser(), createUser()]);
			await renoteMutingsRepository.insert([
				{ id: idService.gen(), muterId: muter.id, muteeId: src.id },
				{ id: idService.gen(), muterId: muter.id, muteeId: dst.id },
			]);

			await accountMoveService.copyRenoteMutings(src, dst);

			expect(await renoteMutingsRepository.countBy({ muterId: muter.id, muteeId: dst.id })).toBe(1);
		});

		test('leaves the destination alone when the source has no renote mutes', async () => {
			const [src, dst, other] = await Promise.all([createUser(), createUser(), createUser()]);
			expect((await cacheService.getUserRelation(other.id, dst.id)).isMutingRenotes).toBe(false);

			await accountMoveService.copyRenoteMutings(src, dst);

			expect(await renoteMutingsRepository.countBy({ muteeId: dst.id })).toBe(0);
			expect((await cacheService.getUserRelation(other.id, dst.id)).isMutingRenotes).toBe(false);
		});
	});
});
