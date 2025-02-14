/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { TimeService } from '@/core/TimeService.js';
import type { EnvService } from '@/core/EnvService.js';
import { BucketRateLimit, LegacyRateLimit, LimitInfo, RateLimit, hasMinLimit, isLegacyRateLimit, Keyed, hasMaxLimit, disabledLimitInfo, MaxLegacyLimit, MinLegacyLimit } from '@/misc/rate-limit-utils.js';
import { DI } from '@/di-symbols.js';
import { MemoryKVCache } from '@/misc/cache.js';
import type { MiUser } from '@/models/_.js';
import type { RoleService } from '@/core/RoleService.js';

// Sentinel value used for caching the default role template.
// Required because MemoryKVCache doesn't support null keys.
const defaultUserKey = '';

@Injectable()
export class SkRateLimiterService {
	// 1-minute cache interval
	private readonly factorCache = new MemoryKVCache<number>(1000 * 60);
	private readonly disabled: boolean;

	constructor(
		@Inject('TimeService')
		private readonly timeService: TimeService,

		@Inject(DI.redis)
		private readonly redisClient: Redis.Redis,

		@Inject('RoleService')
		private readonly roleService: RoleService,

		@Inject('EnvService')
		envService: EnvService,
	) {
		this.disabled = envService.env.NODE_ENV === 'test';
	}

	/**
	 * Check & increment a rate limit for a client.
	 *
	 * If the client (actorOrUser) is passed as a string, then it uses the default rate limit factor from the role template.
	 * If the client (actorOrUser) is passed as an MiUser, then it queries the user's actual rate limit factor from their assigned roles.
	 *
	 * A factor of zero (0) will disable the limit, while any negative number will produce an error.
	 * A factor between zero (0) and one (1) will increase the limit from its default values (allowing more actions per time interval).
	 * A factor greater than one (1) will decrease the limit from its default values (allowing fewer actions per time interval).
	 *
	 * @param limit The limit definition
	 * @param actorOrUser authenticated client user or IP hash
	 */
	public async limit(limit: Keyed<RateLimit>, actorOrUser: string | MiUser): Promise<LimitInfo> {
		if (this.disabled) {
			return disabledLimitInfo;
		}

		const actor = typeof(actorOrUser) === 'object' ? actorOrUser.id : actorOrUser;
		const userCacheKey = typeof(actorOrUser) === 'object' ? actorOrUser.id : defaultUserKey;
		const userRoleKey = typeof(actorOrUser) === 'object' ? actorOrUser.id : null;
		const factor = this.factorCache.get(userCacheKey) ?? await this.factorCache.fetch(userCacheKey, async () => {
			const role = await this.roleService.getUserPolicies(userRoleKey);
			return role.rateLimitFactor;
		});

		if (factor === 0) {
			return disabledLimitInfo;
		}

		if (factor < 0) {
			throw new Error(`Rate limit factor is zero or negative: ${factor}`);
		}

		if (isLegacyRateLimit(limit)) {
			return await this.limitLegacy(limit, actor, factor);
		} else {
			return await this.limitBucket(limit, actor, factor);
		}
	}

	private async limitLegacy(limit: Keyed<LegacyRateLimit>, actor: string, factor: number): Promise<LimitInfo> {
		if (hasMaxLimit(limit)) {
			return await this.limitLegacyMinMax(limit, actor, factor);
		} else if (hasMinLimit(limit)) {
			return await this.limitLegacyMinOnly(limit, actor, factor);
		} else {
			return disabledLimitInfo;
		}
	}

	private async limitLegacyMinMax(limit: Keyed<MaxLegacyLimit>, actor: string, factor: number): Promise<LimitInfo> {
		if (limit.duration === 0) return disabledLimitInfo;
		if (limit.duration < 0) throw new Error(`Invalid rate limit ${limit.key}: duration is negative (${limit.duration})`);
		if (limit.max < 1) throw new Error(`Invalid rate limit ${limit.key}: max is less than 1 (${limit.max})`);

		// Derive initial dripRate from minInterval OR duration/max.
		const initialDripRate = Math.max(limit.minInterval ?? Math.round(limit.duration / limit.max), 1);

		// Calculate dripSize to reach max at exactly duration
		const dripSize = Math.max(Math.round(limit.max / (limit.duration / initialDripRate)), 1);

		// Calculate final dripRate from dripSize and duration/max
		const dripRate = Math.max(Math.round(limit.duration / (limit.max / dripSize)), 1);

		const bucketLimit: Keyed<BucketRateLimit> = {
			type: 'bucket',
			key: limit.key,
			size: limit.max,
			dripRate,
			dripSize,
		};
		return await this.limitBucket(bucketLimit, actor, factor);
	}

	private async limitLegacyMinOnly(limit: Keyed<MinLegacyLimit>, actor: string, factor: number): Promise<LimitInfo> {
		if (limit.minInterval === 0) return disabledLimitInfo;
		if (limit.minInterval < 0) throw new Error(`Invalid rate limit ${limit.key}: minInterval is negative (${limit.minInterval})`);

		const dripRate = Math.max(Math.round(limit.minInterval), 1);
		const bucketLimit: Keyed<BucketRateLimit> = {
			type: 'bucket',
			key: limit.key,
			size: 1,
			dripRate,
			dripSize: 1,
		};
		return await this.limitBucket(bucketLimit, actor, factor);
	}

	/**
	 * Implementation of Leaky Bucket rate limiting - see SkRateLimiterService.md for details.
	 */
	private async limitBucket(limit: Keyed<BucketRateLimit>, actor: string, factor: number): Promise<LimitInfo> {
		if (limit.size < 1) throw new Error(`Invalid rate limit ${limit.key}: size is less than 1 (${limit.size})`);
		if (limit.dripRate != null && limit.dripRate < 1) throw new Error(`Invalid rate limit ${limit.key}: dripRate is less than 1 (${limit.dripRate})`);
		if (limit.dripSize != null && limit.dripSize < 1) throw new Error(`Invalid rate limit ${limit.key}: dripSize is less than 1 (${limit.dripSize})`);

		// 0 - Calculate
		const now = this.timeService.now;
		const bucketSize = Math.max(Math.ceil(limit.size / factor), 1);
		const dripRate = Math.ceil(limit.dripRate ?? 1000);
		const dripSize = Math.ceil(limit.dripSize ?? 1);
		const expirationSec = Math.max(Math.ceil((dripRate * Math.ceil(bucketSize / dripSize)) / 1000), 1);

		// 1 - Read
		const counterKey = createLimitKey(limit, actor, 'c');
		const timestampKey = createLimitKey(limit, actor, 't');
		const counter = await this.getLimitCounter(counterKey, timestampKey);

		// 2 - Drip
		const dripsSinceLastTick = Math.floor((now - counter.timestamp) / dripRate) * dripSize;
		const deltaCounter = Math.min(dripsSinceLastTick, counter.counter);
		const deltaTimestamp = dripsSinceLastTick * dripRate;
		if (deltaCounter > 0) {
			// Execute the next drip(s)
			const results = await this.executeRedisMulti(
				['get', timestampKey],
				['incrby', timestampKey, deltaTimestamp],
				['expire', timestampKey, expirationSec],
				['get', timestampKey],
				['decrby', counterKey, deltaCounter],
				['expire', counterKey, expirationSec],
				['get', counterKey],
			);
			const expectedTimestamp = counter.timestamp;
			const canaryTimestamp = results[0] ? parseInt(results[0]) : 0;
			counter.timestamp = results[3] ? parseInt(results[3]) : 0;
			counter.counter = results[6] ? parseInt(results[6]) : 0;

			// Check for a data collision and rollback
			if (canaryTimestamp !== expectedTimestamp) {
				const rollbackResults = await this.executeRedisMulti(
					['decrby', timestampKey, deltaTimestamp],
					['get', timestampKey],
					['incrby', counterKey, deltaCounter],
					['get', counterKey],
				);
				counter.timestamp = rollbackResults[1] ? parseInt(rollbackResults[1]) : 0;
				counter.counter = rollbackResults[3] ? parseInt(rollbackResults[3]) : 0;
			}
		}

		// 3 - Check
		const blocked = counter.counter >= bucketSize;
		if (!blocked) {
			if (counter.timestamp === 0) {
				const results = await this.executeRedisMulti(
					['set', timestampKey, now],
					['expire', timestampKey, expirationSec],
					['incr', counterKey],
					['expire', counterKey, expirationSec],
					['get', counterKey],
				);
				counter.timestamp = now;
				counter.counter = results[4] ? parseInt(results[4]) : 0;
			} else {
				const results = await this.executeRedisMulti(
					['incr', counterKey],
					['expire', counterKey, expirationSec],
					['get', counterKey],
				);
				counter.counter = results[2] ? parseInt(results[2]) : 0;
			}
		}

		// Calculate how much time is needed to free up a bucket slot
		const overflow = Math.max((counter.counter + 1) - bucketSize, 0);
		const dripsNeeded = Math.ceil(overflow / dripSize);
		const timeNeeded = Math.max((dripRate * dripsNeeded) - (this.timeService.now - counter.timestamp), 0);

		// Calculate limit status
		const remaining = Math.max(bucketSize - counter.counter, 0);
		const resetMs = timeNeeded;
		const resetSec = Math.ceil(resetMs / 1000);
		const fullResetMs = Math.ceil(counter.counter / dripSize) * dripRate;
		const fullResetSec = Math.ceil(fullResetMs / 1000);
		return { blocked, remaining, resetSec, resetMs, fullResetSec, fullResetMs };
	}

	private async getLimitCounter(counterKey: string, timestampKey: string): Promise<LimitCounter> {
		const [counter, timestamp] = await this.executeRedisMulti(
			['get', counterKey],
			['get', timestampKey],
		);

		return {
			counter: counter ? parseInt(counter) : 0,
			timestamp: timestamp ? parseInt(timestamp) : 0,
		};
	}

	private async executeRedisMulti(...batch: RedisCommand[]): Promise<RedisResult[]> {
		const results = await this.redisClient.multi(batch).exec();

		// Transaction conflict (retryable)
		if (!results) {
			throw new ConflictError('Redis error: transaction conflict');
		}

		// Transaction failed (fatal)
		if (results.length !== batch.length) {
			throw new Error('Redis error: failed to execute batch');
		}

		// Map responses
		const errors: Error[] = [];
		const responses: RedisResult[] = [];
		for (const [error, response] of results) {
			if (error) errors.push(error);
			responses.push(response as RedisResult);
		}

		// Command failed (fatal)
		if (errors.length > 0) {
			const errorMessages = errors
				.map((e, i) => `Error in command ${i}: ${e}`)
				.join('\', \'');
			throw new AggregateError(errors, `Redis error: failed to execute command(s): '${errorMessages}'`);
		}

		return responses;
	}
}

// Not correct, but good enough for the basic commands we use.
type RedisResult = string | null;
type RedisCommand = [command: string, ...args: unknown[]];

function createLimitKey(limit: Keyed<RateLimit>, actor: string, value: string): string {
	return `rl_${actor}_${limit.key}_${value}`;
}

class ConflictError extends Error {}

interface LimitCounter {
	timestamp: number;
	counter: number;
}
