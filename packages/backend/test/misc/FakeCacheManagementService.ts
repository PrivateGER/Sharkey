/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { GodOfTimeService } from './GodOfTimeService.js';
import { MockInternalEventService } from './MockInternalEventService.js';
import { MockRedis } from './MockRedis.js';
import { MockConsole } from './MockConsole.js';
import { MockEnvService } from './MockEnvService.js';
import type { QuantumKVOpts } from '@/misc/QuantumKVCache.js';
import type { RedisKVCacheOpts, RedisSingleCacheOpts, MemoryCacheOpts } from '@/misc/cache.js';
import type { Redis } from 'ioredis';
import type { Config } from '@/config.js';
import type { Console } from '@/logger.js';
import { TimeService } from '@/global/TimeService.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import { EnvService } from '@/global/EnvService.js';
import { LoggerService } from '@/core/LoggerService.js';
import {
	CacheManagementService,
	type ManagedMemoryKVCache,
	type ManagedMemorySingleCache,
	type ManagedRedisKVCache,
	type ManagedRedisSingleCache,
	type ManagedQuantumKVCache,
} from '@/global/CacheManagementService.js';
import { DI } from '@/di-symbols.js';

/**
 * Fake implementation of cache management that suppresses all caching behavior.
 * The returned cache instances are real and fully functional, but expiration is negative to ensure that data is immediately discarded and nothing is cached.
 * Essentially, it strips out the caching behavior and converts caches into pure data accessors.
 */
@Injectable()
export class FakeCacheManagementService extends CacheManagementService {
	constructor(
		@Inject(DI.redis)
		redisClient: Redis,

		timeService: TimeService,
		internalEventService: InternalEventService,
		loggerService: LoggerService,
	) {
		super(redisClient, timeService, internalEventService, loggerService);
	}

	createMemoryKVCache<T>(name: string, optsOrLifetime: number | MemoryCacheOpts): ManagedMemoryKVCache<T> {
		const opts = typeof(optsOrLifetime) === 'number' ? { lifetime: -1 } : { ...optsOrLifetime, lifetime: -1 };
		return super.createMemoryKVCache(name, opts);
	}

	createMemorySingleCache<T>(name: string, optsOrLifetime: number | MemoryCacheOpts): ManagedMemorySingleCache<T> {
		const opts = typeof(optsOrLifetime) === 'number' ? { lifetime: -1 } : { ...optsOrLifetime, lifetime: -1 };
		return super.createMemorySingleCache(name, opts);
	}

	createRedisKVCache<T>(name: string, opts: RedisKVCacheOpts<T>): ManagedRedisKVCache<T> {
		return super.createRedisKVCache(name, {
			...opts,
			lifetime: -1,
			memoryCacheLifetime: -1,
		});
	}

	createRedisSingleCache<T>(name: string, opts: RedisSingleCacheOpts<T>): ManagedRedisSingleCache<T> {
		return super.createRedisSingleCache(name, {
			...opts,
			lifetime: -1,
			memoryCacheLifetime: -1,
		});
	}

	createQuantumKVCache<T>(name: string, opts: QuantumKVOpts<T>): ManagedQuantumKVCache<T> {
		return super.createQuantumKVCache(name, {
			...opts,
			lifetime: -1,
		});
	}

	public static create(opts?: {
		timeService?: TimeService,
		console?: Console,
		envService?: EnvService,
		loggerService?: LoggerService,
		redisClient?: Redis,
		redisForPub?: Redis,
		redisForSub?: Redis,
		config?: Config,
		internalEventService?: InternalEventService,
	}): FakeCacheManagementService {
		// Global services
		const timeService = opts?.timeService ?? new GodOfTimeService();
		const console = opts?.console ?? new MockConsole();
		const envService = opts?.envService ?? new MockEnvService();
		const loggerService = opts?.loggerService ?? new LoggerService(console, timeService, envService);

		// Redis connections
		const redisClient = opts?.redisClient ?? opts?.redisForPub ?? opts?.redisForSub ?? new MockRedis(timeService);
		const redisForPub = opts?.redisForPub ?? redisClient;
		const redisForSub = opts?.redisForSub ?? redisClient;

		// Core services
		const internalEventService = opts?.internalEventService ?? MockInternalEventService.create({ config: opts?.config, redisForPub, redisForSub });

		return new FakeCacheManagementService(redisClient, timeService, internalEventService, loggerService);
	}
}
