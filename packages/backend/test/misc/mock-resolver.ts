/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject } from '@nestjs/common';
import { MockConsole } from './MockConsole.js';
import { MockEnvService } from './MockEnvService.js';
import type { Config } from '@/config.js';
import type { ApDbResolverService } from '@/core/activitypub/ApDbResolverService.js';
import type { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import type { ApRequestService } from '@/core/activitypub/ApRequestService.js';
import type { IObject, IObjectWithId } from '@/core/activitypub/type.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { UtilityService } from '@/core/UtilityService.js';
import type {
	FollowRequestsRepository,
	MiMeta,
	NoteReactionsRepository,
	NotesRepository,
	PollsRepository,
	UsersRepository,
} from '@/models/_.js';
import type { CacheService } from '@/core/CacheService.js';
import type { MiLocalUser } from '@/models/User.js';
import { ApLogService } from '@/core/ApLogService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { ApUtilityService } from '@/core/activitypub/ApUtilityService.js';
import { fromTuple } from '@/misc/from-tuple.js';
import { SystemAccountService } from '@/core/SystemAccountService.js';
import { bindThis } from '@/decorators.js';
import { Resolver, type FetchBudget } from '@/core/activitypub/ApResolverService.js';
import { DI } from '@/di-symbols.js';
import { NativeTimeService } from '@/global/TimeService.js';

type MockResponse = {
	type: string;
	content: string;
};

export class MockResolver extends Resolver {
	#responseMap = new Map<string, MockResponse>();
	#remoteGetTrials: string[] = [];

	constructor(
		@Inject(DI.config)
		config?: Config,

		@Inject(DI.meta)
		meta?: MiMeta,

		@Inject(DI.usersRepository)
		usersRepository?: UsersRepository,

		@Inject(DI.notesRepository)
		notesRepository?: NotesRepository,

		@Inject(DI.pollsRepository)
		pollsRepository?: PollsRepository,

		@Inject(DI.noteReactionsRepository)
		noteReactionsRepository?: NoteReactionsRepository,

		@Inject(DI.followRequestsRepository)
		followRequestsRepository?: FollowRequestsRepository,

		utilityService?: UtilityService,
		systemAccountService?: SystemAccountService,
		apRequestService?: ApRequestService,
		httpRequestService?: HttpRequestService,
		apRendererService?: ApRendererService,
		apDbResolverService?: ApDbResolverService,
		loggerService?: LoggerService,
		apLogService?: ApLogService,
		apUtilityService?: ApUtilityService,
		cacheService?: CacheService,
		recursionLimit?: number,
		fetchBudget?: FetchBudget,
	) {
		super(
			config ?? {} as Config,
			meta ?? {} as MiMeta,
			usersRepository ?? {} as UsersRepository,
			notesRepository ?? {} as NotesRepository,
			pollsRepository ?? {} as PollsRepository,
			noteReactionsRepository ?? {} as NoteReactionsRepository,
			followRequestsRepository ?? {} as FollowRequestsRepository,
			utilityService ?? {} as UtilityService,
			systemAccountService ?? {} as SystemAccountService,
			apRequestService ?? {} as ApRequestService,
			httpRequestService ?? {} as HttpRequestService,
			apRendererService ?? {} as ApRendererService,
			apDbResolverService ?? {} as ApDbResolverService,
			loggerService ?? new LoggerService(new MockConsole(), new NativeTimeService(), new MockEnvService()),
			apLogService ?? {} as ApLogService,
			apUtilityService ?? {} as ApUtilityService,
			cacheService ?? {} as CacheService,
			recursionLimit,
			fetchBudget,
		);
	}

	public register(uri: string, content: string | Record<string, any>, type = 'application/activity+json'): void {
		this.#responseMap.set(uri, {
			type,
			content: typeof content === 'string' ? content : JSON.stringify(content),
		});
	}

	/**
	 * Makes this resolver serve (and record requests against) the responses registered on `source`, while keeping its own history and limits.
	 */
	public shareRegistrations(source: MockResolver): void {
		this.#responseMap = source.#responseMap;
		this.#remoteGetTrials = source.#remoteGetTrials;
	}

	public clear(): void {
		this.history.clear();
		this.#responseMap.clear();
		this.#remoteGetTrials.length = 0;
	}

	public remoteGetTrials(): string[] {
		return this.#remoteGetTrials;
	}

	public async resolve(value: string | [string], allowAnonymous?: boolean, fetchUser?: MiLocalUser): Promise<IObjectWithId>;
	public async resolve(value: string | IObjectWithId | [string | IObjectWithId], allowAnonymous?: boolean, fetchUser?: MiLocalUser): Promise<IObjectWithId>;
	public async resolve(value: string | IObject | [string | IObject], allowAnonymous?: boolean, fetchUser?: MiLocalUser): Promise<IObject>;
	@bindThis
	public async resolve(value: string | IObject | [string | IObject]): Promise<IObject> {
		value = fromTuple(value);
		if (typeof value !== 'string') return value;

		this.claimFetch(value);

		this.#remoteGetTrials.push(value);
		const r = this.#responseMap.get(value);

		if (!r) {
			throw new Error('Not registed for mock');
		}

		const object = JSON.parse(r.content);

		return object;
	}
}
