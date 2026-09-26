/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';
import { UnrecoverableError } from 'bullmq';
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
import { ApNoteService } from '@/core/activitypub/models/ApNoteService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { CacheService } from '@/core/CacheService.js';
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
	let createBackfillRepliesJob: jest.Mock<(noteId: string, automatic: boolean, backfillId: string) => Promise<void>>;
	let backfillReplies: jest.Mock<(uri: string, opts: unknown) => Promise<{ imported: number, complete: boolean }>>;
	let publishNoteStream: jest.Mock<(noteId: string, type: string, value: { body: unknown }) => Promise<void>>;
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
				{ provide: QueueService, useValue: { createBackfillRepliesJob: jest.fn() } },
				{ provide: ApNoteService, useValue: { backfillReplies: jest.fn() } },
				{ provide: GlobalEventService, useValue: { publishNoteStream: jest.fn() } },
				{ provide: CacheService, useValue: { findUserById: async () => ({ isSuspended: false }) } },
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
		createBackfillRepliesJob = app.get<{ createBackfillRepliesJob: typeof createBackfillRepliesJob }>(QueueService).createBackfillRepliesJob;
		backfillReplies = app.get<{ backfillReplies: typeof backfillReplies }>(ApNoteService).backfillReplies;
		publishNoteStream = app.get<{ publishNoteStream: typeof publishNoteStream }>(GlobalEventService).publishNoteStream;

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
		createBackfillRepliesJob.mockReset();
		backfillReplies.mockReset();
		publishNoteStream.mockReset();
		app.get<MockRedis>(DI.redis).mockReset();
		meta.enableAutoReplyBackfill = true;
		meta.federation = 'all';
		meta.blockedHosts = [];
		clock.resetToNow();

		viewer = await createUser(null) as MiLocalUser;
		remoteAuthor = await createUser('remote.test');
	});

	async function runLastQueued(): Promise<string> {
		const [noteId, automatic, backfillId] = createBackfillRepliesJob.mock.calls.at(-1)!;
		return await service.run(noteId, automatic, backfillId);
	}

	test('queues a backfill for a recently active remote thread, then waits for the cooldown', async () => {
		const root = await createNote(remoteAuthor);
		backfillReplies.mockResolvedValue({ imported: 0, complete: true });

		await service.requestAutomatic(root.id, viewer);
		await runLastQueued();
		clock.tick(4 * minute);
		await service.requestAutomatic(root.id, viewer);
		clock.tick(2 * minute);
		await service.requestAutomatic(root.id, viewer);

		expect(createBackfillRepliesJob.mock.calls.map(([noteId, automatic]) => [noteId, automatic])).toEqual([[root.id, true], [root.id, true]]);
	});

	test('becomes due again as soon as a quiet thread gets a new reply', async () => {
		const root = await createNote(remoteAuthor);
		clock.tick(30 * day);

		await service.requestAutomatic(root.id, viewer);
		clock.tick(day);
		await service.requestAutomatic(root.id, viewer);
		expect(createBackfillRepliesJob).toHaveBeenCalledTimes(1);

		await createNote(remoteAuthor, { replyId: root.id, threadId: root.id });
		clock.tick(10 * minute);
		await service.requestAutomatic(root.id, viewer);

		expect(createBackfillRepliesJob).toHaveBeenCalledTimes(2);
	});

	test('treats replies as covered by a complete backfill of an ancestor until the cooldown ends', async () => {
		const root = await createNote(remoteAuthor);
		const reply = await createNote(remoteAuthor, { replyId: root.id, threadId: root.id });
		const nested = await createNote(remoteAuthor, { replyId: reply.id, threadId: root.id });
		backfillReplies.mockResolvedValue({ imported: 0, complete: true });

		await service.requestAutomatic(root.id, viewer);
		await runLastQueued();
		await service.requestAutomatic(reply.id, viewer);
		await service.requestAutomatic(nested.id, viewer);
		expect(createBackfillRepliesJob).toHaveBeenCalledTimes(1);

		clock.tick(5 * minute);
		await service.requestAutomatic(nested.id, viewer);

		expect(createBackfillRepliesJob.mock.calls.map(([noteId]) => noteId)).toEqual([root.id, nested.id]);
	});

	test('does not treat replies as covered by a backfill of an ancestor that hit its limits', async () => {
		const root = await createNote(remoteAuthor);
		const reply = await createNote(remoteAuthor, { replyId: root.id, threadId: root.id });
		backfillReplies.mockResolvedValue({ imported: 30, complete: false });

		await service.requestAutomatic(root.id, viewer);
		await runLastQueued();
		await service.requestAutomatic(reply.id, viewer);

		expect(createBackfillRepliesJob.mock.calls.map(([noteId]) => noteId)).toEqual([root.id, reply.id]);
	});

	test('waits for a pending backfill of an ancestor before queueing one for a reply', async () => {
		const root = await createNote(remoteAuthor);
		const reply = await createNote(remoteAuthor, { replyId: root.id, threadId: root.id });
		backfillReplies.mockResolvedValue({ imported: 30, complete: false });

		await service.requestAutomatic(root.id, viewer);
		await service.requestAutomatic(reply.id, viewer);
		expect(createBackfillRepliesJob).toHaveBeenCalledTimes(1);

		await runLastQueued();
		await service.requestAutomatic(reply.id, viewer);

		expect(createBackfillRepliesJob.mock.calls.map(([noteId]) => noteId)).toEqual([root.id, reply.id]);
	});

	test('treats a note as covered by its own complete manual backfill', async () => {
		const root = await createNote(remoteAuthor);
		backfillReplies.mockResolvedValue({ imported: 0, complete: true });

		await service.requestManual(root.id);
		await runLastQueued();
		await service.requestAutomatic(root.id, viewer);

		expect(createBackfillRepliesJob).toHaveBeenCalledTimes(1);
	});

	test('does not queue a backfill for a thread quiet for over 90 days', async () => {
		const root = await createNote(remoteAuthor);
		clock.tick(91 * day);

		await service.requestAutomatic(root.id, viewer);

		expect(createBackfillRepliesJob).not.toHaveBeenCalled();
	});

	test('does not queue a backfill when the server disables it', async () => {
		const root = await createNote(remoteAuthor);
		meta.enableAutoReplyBackfill = false;

		await service.requestAutomatic(root.id, viewer);

		expect(createBackfillRepliesJob).not.toHaveBeenCalled();
	});

	test('does not queue a backfill for a note from a host the server does not federate with', async () => {
		const root = await createNote(remoteAuthor);
		meta.blockedHosts = ['remote.test'];

		await service.requestAutomatic(root.id, viewer);

		expect(createBackfillRepliesJob).not.toHaveBeenCalled();
	});

	test('does not queue a backfill for local or non-public notes', async () => {
		const localNote = await createNote(viewer);
		const followersOnly = await createNote(remoteAuthor, { visibility: 'followers' });

		await service.requestAutomatic(localNote.id, viewer);
		await service.requestAutomatic(followersOnly.id, viewer);

		expect(createBackfillRepliesJob).not.toHaveBeenCalled();
	});

	test('reports a manual request as running until the backfill finishes, then as recently checked for 15 minutes', async () => {
		const root = await createNote(remoteAuthor);
		backfillReplies.mockResolvedValue({ imported: 0, complete: true });

		const first = await service.requestManual(root.id);
		expect(first).toEqual({ status: 'queued', backfillId: expect.any(String) });
		expect(await service.requestManual(root.id)).toEqual({ status: 'running', backfillId: (first as { backfillId: string }).backfillId });

		await runLastQueued();
		expect(await service.requestManual(root.id)).toEqual({ status: 'recentlyChecked' });

		clock.tick(15 * minute);
		expect(await service.requestManual(root.id)).toMatchObject({ status: 'queued' });
		expect(createBackfillRepliesJob).toHaveBeenCalledTimes(2);
	});

	test('runs at most one backfill per note, and a manual request follows a pending automatic one', async () => {
		const root = await createNote(remoteAuthor);
		backfillReplies.mockResolvedValue({ imported: 0, complete: true });

		await service.requestAutomatic(root.id, viewer);
		const [, , automaticId] = createBackfillRepliesJob.mock.calls[0];

		expect(await service.requestManual(root.id)).toEqual({ status: 'running', backfillId: automaticId });
		expect(createBackfillRepliesJob).toHaveBeenCalledTimes(1);

		await runLastQueued();
		expect(await service.requestManual(root.id)).toMatchObject({ status: 'queued' });
	});

	test('a backfill that outlived its reservation does not end the next one', async () => {
		const root = await createNote(remoteAuthor);
		backfillReplies.mockResolvedValue({ imported: 0, complete: true });

		await service.requestManual(root.id);
		const [, , staleId] = createBackfillRepliesJob.mock.calls[0];
		clock.tick(15 * minute);
		const current = await service.requestManual(root.id);
		expect(current).toMatchObject({ status: 'queued' });

		await service.run(root.id, false, staleId);

		expect(await service.requestManual(root.id)).toEqual({ status: 'running', backfillId: (current as { backfillId: string }).backfillId });
	});

	test('announces the start and result of a backfill on the note stream', async () => {
		const root = await createNote(remoteAuthor);
		backfillReplies.mockResolvedValue({ imported: 3, complete: true });

		await service.run(root.id, true, 'b1');

		expect(publishNoteStream.mock.calls.map(([noteId, type, value]) => [noteId, type, value.body])).toEqual([
			[root.id, 'repliesBackfillStarted', { backfillId: 'b1', automatic: true }],
			[root.id, 'repliesBackfilled', { backfillId: 'b1', automatic: true, imported: 3, failed: false }],
		]);
	});

	test('announces a failed backfill and fails the job without retrying', async () => {
		const root = await createNote(remoteAuthor);
		backfillReplies.mockRejectedValue(new Error('origin unreachable'));

		await expect(service.run(root.id, false, 'b1')).rejects.toBeInstanceOf(UnrecoverableError);

		expect(publishNoteStream).toHaveBeenLastCalledWith(root.id, 'repliesBackfilled', expect.objectContaining({
			body: { backfillId: 'b1', automatic: false, imported: 0, failed: true },
		}));
	});

	test('closes out a queued manual request when the job is skipped', async () => {
		const root = await createNote(remoteAuthor);
		const queued = await service.requestManual(root.id);
		meta.blockedHosts = ['remote.test'];

		await runLastQueued();

		expect(backfillReplies).not.toHaveBeenCalled();
		expect(publishNoteStream.mock.calls.map(([, type, value]) => [type, value.body])).toEqual([
			['repliesBackfilled', { backfillId: (queued as { backfillId: string }).backfillId, automatic: false, imported: 0, failed: true }],
		]);
		expect(await service.requestManual(root.id)).toEqual({ status: 'recentlyChecked' });
	});
});
