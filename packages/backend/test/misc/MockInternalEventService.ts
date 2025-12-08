/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Config } from '@/config.js';
import type { InternalEventContext, InternalEventProps, InternalEventTypes } from '@/global/InternalEventService.js';
import type { AnyListener, EventListener } from '@/misc/SkEventEmitter.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import { bindThis } from '@/decorators.js';
import { DI } from '@/di-symbols.js';
import { MockRedis } from './MockRedis.js';
import { TimeService } from '@/global/TimeService.js';
import { GodOfTimeService } from './GodOfTimeService.js';

type FakeCall<K extends keyof InternalEventService> = [K, Parameters<InternalEventService[K]>];

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
	 * Resets the mock.
	 * Clears all listeners and tracked calls.
	 */
	public mockReset() {
		this._calls = [];
	}

	/**
	 * Simulates a remote event sent from another process in the cluster via redis.
	 */
	@bindThis
	public async mockEmitFromRedis<K extends keyof InternalEventTypes>(type: K, value: InternalEventTypes[K]): Promise<void> {
		await super.emitLocally(type, value, { isLocal: false });
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
	public override on<K extends keyof InternalEventTypes>(type: K, listener: EventListener<InternalEventTypes, K>, props?: Partial<InternalEventProps>): void {
		this._calls.push(['on', [type, listener as AnyListener, props]]);
		super.on(type, listener, props);
	}

	@bindThis
	public override off<K extends keyof InternalEventTypes>(type: K, listener: EventListener<InternalEventTypes, K>): void {
		this._calls.push(['off', [type, listener]]);
		super.off(type, listener);
	}

	@bindThis
	public override async emit<K extends keyof InternalEventTypes>(type: K, value: InternalEventTypes[K], context?: InternalEventContext): Promise<void> {
		this._calls.push(['emit', [type, value, context]]);
		await super.emit(type, value, context);
	}

	@bindThis
	protected override async emitExternally(): Promise<void> {
		// Disable external emit for testing
	}

	@bindThis
	public override connect(): void {
		this._calls.push(['connect', []]);
		// Disable external events for testing
	}

	@bindThis
	public override disconnect(): void {
		this._calls.push(['disconnect', []]);
		// Disable external events for testing
	}

	@bindThis
	public override dispose(): void {
		this._calls.push(['dispose', []]);
		super.dispose();
	}

	@bindThis
	public override onApplicationShutdown(): void {
		this._calls.push(['onApplicationShutdown', []]);
		super.onApplicationShutdown();
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

