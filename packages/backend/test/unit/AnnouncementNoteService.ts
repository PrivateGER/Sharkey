/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { MockRedis } from '../misc/MockRedis.js';
import { FakeCacheManagementService } from '../misc/FakeCacheManagementService.js';
import type { TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import type { InstancesRepository, MetasRepository, MiMeta, NotesRepository, UsersRepository } from '@/models/_.js';
import { MiNote } from '@/models/Note.js';
import { MiUser } from '@/models/User.js';
import { GlobalModule } from '@/GlobalModule.js';
import { AnnouncementNoteService } from '@/core/AnnouncementNoteService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { RoleService } from '@/core/RoleService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { CacheService } from '@/core/CacheService.js';
import { IdService } from '@/core/IdService.js';
import { CacheManagementService } from '@/global/CacheManagementService.js';
import { DI } from '@/di-symbols.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';

describe(AnnouncementNoteService, () => {
	let app: TestingModule;
	let service: AnnouncementNoteService;
	let idService: IdService;
	let meta: MiMeta;
	let usersRepository: UsersRepository;
	let notesRepository: NotesRepository;
	let createNotificationImmediate: jest.Mock<(notifieeId: string, type: string, data: unknown) => Promise<unknown>>;
	let isAdministrator: jest.Mock<(user: MiUser) => Promise<boolean>>;
	let admin: MiUser;

	async function createUser(data: Partial<MiUser> = {}): Promise<MiUser> {
		const username = data.username ?? secureRndstr(12);
		const user = new MiUser({ id: idService.gen(), username, usernameLower: username.toLowerCase(), host: null, approved: true, ...data });
		await usersRepository.insert(user);
		return user;
	}

	async function createNote(author: MiUser): Promise<MiNote> {
		const note = new MiNote({
			id: idService.gen(),
			userId: author.id,
			userHost: author.host,
			visibility: 'public',
			localOnly: false,
			text: 'announcement',
			cw: null,
			renoteCount: 0,
			repliesCount: 0,
			clippedCount: 0,
			reactions: {},
			fileIds: [],
			attachedFileTypes: [],
			visibleUserIds: [],
			mentions: [],
			mentionedRemoteUsers: '[]',
			reactionAndUserPairCache: [],
			emojis: [],
			tags: [],
			hasPoll: false,
		});
		await notesRepository.insert(note);
		return note;
	}

	function notifiedUserIds(noteId: string): string[] {
		return createNotificationImmediate.mock.calls
			.filter(([, type, data]) => type === 'announcementNote' && (data as { noteId: string }).noteId === noteId)
			.map(([notifieeId]) => notifieeId);
	}

	beforeAll(async () => {
		app = await Test.createTestingModule({
			imports: [GlobalModule],
			providers: [
				AnnouncementNoteService,
				IdService,
				UtilityService,
				{ provide: NotificationService, useValue: { createNotificationImmediate: jest.fn() } },
				{ provide: RoleService, useValue: { isAdministrator: jest.fn() } },
				{
					provide: CacheService,
					inject: [DI.usersRepository],
					useFactory: (users: UsersRepository) => ({ findUserById: (id: string) => users.findOneByOrFail({ id }) }),
				},
			],
		})
			.overrideProvider(DI.meta).useFactory({
				inject: [DI.metasRepository],
				factory: async (metasRepository: MetasRepository) => {
					let defaultMeta = await metasRepository.findOneBy({});
					if (!defaultMeta) {
						await metasRepository.insert({ id: 'x' });
						defaultMeta = await metasRepository.findOneByOrFail({});
					}
					return Object.create(defaultMeta);
				},
			})
			.overrideProvider(DI.redis).useClass(MockRedis)
			.overrideProvider(DI.redisForPub).useFactory({ inject: [DI.redis], factory: (redisClient: Redis) => redisClient })
			.overrideProvider(DI.redisForSub).useFactory({ inject: [DI.redis], factory: (redisClient: Redis) => redisClient })
			.overrideProvider(DI.redisForRateLimit).useFactory({ inject: [DI.redis], factory: (redisClient: Redis) => redisClient })
			.overrideProvider(DI.redisForReactions).useFactory({ inject: [DI.redis], factory: (redisClient: Redis) => redisClient })
			.overrideProvider(DI.redisForTimelines).useFactory({ inject: [DI.redis], factory: (redisClient: Redis) => redisClient })
			.overrideProvider(CacheManagementService).useClass(FakeCacheManagementService)
			.compile();

		await app.init();

		service = app.get(AnnouncementNoteService);
		idService = app.get(IdService);
		meta = app.get<MiMeta>(DI.meta);
		usersRepository = app.get(DI.usersRepository);
		notesRepository = app.get(DI.notesRepository);
		createNotificationImmediate = app.get<{ createNotificationImmediate: typeof createNotificationImmediate }>(NotificationService).createNotificationImmediate;
		isAdministrator = app.get<{ isAdministrator: typeof isAdministrator }>(RoleService).isAdministrator;

		await app.get<InstancesRepository>(DI.instancesRepository).createQueryBuilder()
			.insert()
			.values({ id: idService.gen(), host: 'remote.test', firstRetrievedAt: new Date() })
			.orIgnore()
			.execute();
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(async () => {
		await notesRepository.deleteAll();
		await usersRepository.deleteAll();
		app.get<MockRedis>(DI.redis).mockReset();
		createNotificationImmediate.mockReset();
		createNotificationImmediate.mockResolvedValue(null);
		isAdministrator.mockReset();
		isAdministrator.mockImplementation(async user => user.id === admin.id);
		meta.approvalRequiredForSignup = true;

		admin = await createUser();
	});

	test('notifies every active local user except the author', async () => {
		const alice = await createUser();
		const bob = await createUser();
		await createUser({ host: 'remote.test' });
		await createUser({ isSuspended: true });
		await createUser({ isDeleted: true });
		await createUser({ approved: false });
		await createUser({ username: 'instance.actor' });
		const note = await createNote(admin);

		await service.notifyLocalUsers(note.id);

		expect(notifiedUserIds(note.id).toSorted()).toEqual([alice.id, bob.id].toSorted());
	});

	test('notifies unapproved users when the server does not require approval', async () => {
		meta.approvalRequiredForSignup = false;
		const unapproved = await createUser({ approved: false });
		const note = await createNote(admin);

		await service.notifyLocalUsers(note.id);

		expect(notifiedUserIds(note.id)).toEqual([unapproved.id]);
	});

	test('notifies nobody if the note was deleted before the job ran', async () => {
		await createUser();
		const note = await createNote(admin);
		await notesRepository.delete(note.id);

		await service.notifyLocalUsers(note.id);

		expect(createNotificationImmediate).not.toHaveBeenCalled();
	});

	test('notifies nobody if the author is no longer an administrator', async () => {
		await createUser();
		const note = await createNote(admin);
		isAdministrator.mockResolvedValue(false);

		await service.notifyLocalUsers(note.id);

		expect(createNotificationImmediate).not.toHaveBeenCalled();
	});

	test('a retry after a failure reaches everyone without starting over', async () => {
		const users: MiUser[] = [];
		for (let i = 0; i < 250; i++) users.push(await createUser());
		const failing = users.at(-1)!;
		const note = await createNote(admin);

		createNotificationImmediate.mockImplementation(async notifieeId => {
			if (notifieeId === failing.id) throw new Error('redis unavailable');
			return null;
		});
		await expect(service.notifyLocalUsers(note.id)).rejects.toThrow('redis unavailable');
		const firstRun = new Set(notifiedUserIds(note.id).filter(id => id !== failing.id));

		createNotificationImmediate.mockClear();
		createNotificationImmediate.mockResolvedValue(null);
		await service.notifyLocalUsers(note.id);
		const secondRun = notifiedUserIds(note.id);

		expect(new Set([...firstRun, ...secondRun])).toEqual(new Set(users.map(u => u.id)));
		expect(secondRun.filter(id => firstRun.has(id)).length).toBeLessThan(firstRun.size / 2);
	});
});
