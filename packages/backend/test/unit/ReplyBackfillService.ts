/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { GodOfTimeService } from '../misc/GodOfTimeService.js';
import { MockRedis } from '../misc/MockRedis.js';
import { FakeCacheManagementService } from '../misc/FakeCacheManagementService.js';
import type { TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import type { InstancesRepository, MetasRepository, MiMeta, NotesRepository, UsersRepository } from '@/models/_.js';
import { MiNote } from '@/models/Note.js';
import { MiUser, type MiLocalUser } from '@/models/User.js';
import { GlobalModule } from '@/GlobalModule.js';
import { QueryService } from '@/core/QueryService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { ReplyBackfillService } from '@/core/ReplyBackfillService.js';
import { QueueService } from '@/core/QueueService.js';
import { IdService } from '@/core/IdService.js';
import { TimeService } from '@/global/TimeService.js';
import { CacheManagementService } from '@/global/CacheManagementService.js';
import { DI } from '@/di-symbols.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';

const minute = 1000 * 60;
const day = minute * 60 * 24;

describe(ReplyBackfillService, () => {
	let app: TestingModule;
	let service: ReplyBackfillService;
	let clock: GodOfTimeService;
	let idService: IdService;
	let meta: MiMeta;
	let usersRepository: UsersRepository;
	let notesRepository: NotesRepository;
	let createAutoBackfillRepliesJob: jest.Mock<(noteId: string) => Promise<void>>;
	let viewer: MiLocalUser;
	let remoteAuthor: MiUser;

	async function createUser(host: string | null): Promise<MiUser> {
		const username = secureRndstr(12);
		const user = new MiUser({ id: idService.gen(), username, usernameLower: username.toLowerCase(), host });
		await usersRepository.insert(user);
		return user;
	}

	async function createNote(author: MiUser, data: Partial<MiNote> = {}): Promise<MiNote> {
		const id = idService.gen();
		const note = new MiNote({
			id,
			userId: author.id,
			userHost: author.host,
			uri: author.host != null ? `https://${author.host}/notes/${id}` : null,
			visibility: 'public',
			localOnly: false,
			text: 'note',
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
			...data,
		});
		await notesRepository.insert(note);
		return note;
	}

	beforeAll(async () => {
		app = await Test.createTestingModule({
			imports: [GlobalModule],
			providers: [
				ReplyBackfillService,
				QueryService,
				IdService,
				LoggerService,
				UtilityService,
				{ provide: QueueService, useValue: { createAutoBackfillRepliesJob: jest.fn() } },
			],
		})
			.overrideProvider(TimeService).useClass(GodOfTimeService)
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

		service = app.get(ReplyBackfillService);
		clock = app.get<GodOfTimeService>(TimeService);
		idService = app.get(IdService);
		meta = app.get<MiMeta>(DI.meta);
		usersRepository = app.get(DI.usersRepository);
		notesRepository = app.get(DI.notesRepository);
		createAutoBackfillRepliesJob = app.get<{ createAutoBackfillRepliesJob: typeof createAutoBackfillRepliesJob }>(QueueService).createAutoBackfillRepliesJob;

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
		await usersRepository.deleteAll();
		createAutoBackfillRepliesJob.mockReset();
		meta.enableAutoReplyBackfill = true;
		meta.federation = 'all';
		meta.blockedHosts = [];
		clock.resetToNow();

		viewer = await createUser(null) as MiLocalUser;
		remoteAuthor = await createUser('remote.test');
	});

	test('queues a backfill for a recently active remote thread, then waits for the cooldown', async () => {
		const root = await createNote(remoteAuthor);

		await service.requestAutomatic(root.id, viewer);
		clock.tick(4 * minute);
		await service.requestAutomatic(root.id, viewer);
		clock.tick(2 * minute);
		await service.requestAutomatic(root.id, viewer);

		expect(createAutoBackfillRepliesJob.mock.calls).toEqual([[root.id], [root.id]]);
	});

	test('becomes due again as soon as a quiet thread gets a new reply', async () => {
		const root = await createNote(remoteAuthor);
		clock.tick(30 * day);

		await service.requestAutomatic(root.id, viewer);
		clock.tick(day);
		await service.requestAutomatic(root.id, viewer);
		expect(createAutoBackfillRepliesJob).toHaveBeenCalledTimes(1);

		await createNote(remoteAuthor, { replyId: root.id, threadId: root.id });
		clock.tick(10 * minute);
		await service.requestAutomatic(root.id, viewer);

		expect(createAutoBackfillRepliesJob).toHaveBeenCalledTimes(2);
	});

	test('does not queue a backfill for a thread quiet for over 90 days', async () => {
		const root = await createNote(remoteAuthor);
		clock.tick(91 * day);

		await service.requestAutomatic(root.id, viewer);

		expect(createAutoBackfillRepliesJob).not.toHaveBeenCalled();
	});

	test('does not queue a backfill when the server disables it', async () => {
		const root = await createNote(remoteAuthor);
		meta.enableAutoReplyBackfill = false;

		await service.requestAutomatic(root.id, viewer);

		expect(createAutoBackfillRepliesJob).not.toHaveBeenCalled();
	});

	test('does not queue a backfill for a note from a host the server does not federate with', async () => {
		const root = await createNote(remoteAuthor);
		meta.blockedHosts = ['remote.test'];

		await service.requestAutomatic(root.id, viewer);

		expect(createAutoBackfillRepliesJob).not.toHaveBeenCalled();
	});

	test('does not queue a backfill for local or non-public notes', async () => {
		const localNote = await createNote(viewer);
		const followersOnly = await createNote(remoteAuthor, { visibility: 'followers' });

		await service.requestAutomatic(localNote.id, viewer);
		await service.requestAutomatic(followersOnly.id, viewer);

		expect(createAutoBackfillRepliesJob).not.toHaveBeenCalled();
	});
});
