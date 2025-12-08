/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Listener, ListenerProps, InternalEventTypes, EventValue, AnyListener } from '@/global/InternalEventService.js';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Config } from '@/config.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import { bindThis } from '@/decorators.js';
import { DI } from '@/di-symbols.js';
import { MockRedis } from './MockRedis.js';
import { TimeService } from '@/global/TimeService.js';
import { GodOfTimeService } from './GodOfTimeService.js';

type FakeCall<K extends keyof InternalEventService> = [K, Parameters<InternalEventService[K]>];
type FakeListener = [keyof InternalEventTypes, AnyListener, ListenerProps];

/**
 * Minimal implementation of InternalEventService meant for use in unit tests.
 * There is no redis connection, and metadata is tracked in the public _calls and _listeners arrays.
 * The on/off/emit methods are fully functional and can be called in tests to invoke any registered listeners.
 */
@Injectable()
export class MockInternalEventService extends InternalEventService {
	/**
	 * List of calls to public methods, in chronological order.
	 */
	public _calls: FakeCall<keyof InternalEventService>[] = [];

	/**
	 * List of currently registered listeners.
	 */
	public _listeners: FakeListener[] = [];

	/**
	 * Resets the mock.
	 * Clears all listeners and tracked calls.
	 */
	public mockReset() {
		this._calls = [];
		this._listeners = [];
	}

	/**
	 * Simulates a remote event sent from another process in the cluster via redis.
	 */
	@bindThis
	public async mockEmit<K extends keyof InternalEventTypes>(type: K, value: EventValue<K>): Promise<void> {
		await this.emit(type, value, false);
	}

	constructor(
		@Inject(DI.config)
		config: Config,

		@Inject(DI.redisForPub)
		redisForPub: Redis,

		@Inject(DI.redisForSub)
		redisForSub: Redis,
	) {
		super(redisForPub, redisForSub, config);
	}

	@bindThis
	public on<K extends keyof InternalEventTypes>(type: K, listener: Listener<K>, props?: ListenerProps): void {
		if (!this._listeners.some(l => l[0] === type && l[1] === listener)) {
			this._listeners.push([type, listener as AnyListener, props ?? {}]);
		}
		this._calls.push(['on', [type, listener as AnyListener, props]]);
	}

	@bindThis
	public off<K extends keyof InternalEventTypes>(type: K, listener: Listener<K>): void {
		this._listeners = this._listeners.filter(l => l[0] !== type || l[1] !== listener);
		this._calls.push(['off', [type, listener]]);
	}

	@bindThis
	public async emit<K extends keyof InternalEventTypes>(type: K, value: EventValue<K>, isLocal = true): Promise<void> {
		for (const listener of this._listeners) {
			if (listener[0] === type) {
				if ((isLocal && !listener[2].ignoreLocal) || (!isLocal && !listener[2].ignoreRemote)) {
					await listener[1](value, type, isLocal);
				}
			}
		}
		this._calls.push(['emit', [type, value]]);
	}

	@bindThis
	public dispose(): void {
		this._listeners = [];
		this._calls.push(['dispose', []]);
	}

	@bindThis
	public onApplicationShutdown(): void {
		this._calls.push(['onApplicationShutdown', []]);
	}

	static create(opts?: {
		timeService?: TimeService,
		redisForPub?: Redis,
		redisForSub?: Redis,
		config?: Config,
	}): MockInternalEventService {
		const timeService = opts?.timeService ?? new GodOfTimeService();
		const redisForPub = opts?.redisForPub ?? opts?.redisForSub ?? new MockRedis(timeService);
		const redisForSub = opts?.redisForSub ?? redisForPub;
		const config = opts?.config ?? { host: 'example.com' } as Config;

		return new MockInternalEventService(config, redisForPub, redisForSub);
	}
}

