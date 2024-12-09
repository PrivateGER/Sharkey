/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { KEYWORD } from 'color-convert/conversions.js';
import { jest } from '@jest/globals';
import type Redis from 'ioredis';
import { LimitCounter, SkRateLimiterService } from '@/server/api/SkRateLimiterService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { BucketRateLimit, Keyed, LegacyRateLimit } from '@/misc/rate-limit-utils.js';

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */

describe(SkRateLimiterService, () => {
	let mockTimeService: { now: number, date: Date } = null!;
	let mockRedisGet: ((key: string) => string | null) | undefined = undefined;
	let mockRedisSet: ((args: unknown[]) => void) | undefined = undefined;
	let mockEnvironment: Record<string, string | undefined> = null!;
	let serviceUnderTest: () => SkRateLimiterService = null!;

	let loggedMessages: { level: string, data: unknown[] }[] = [];

	beforeEach(() => {
		mockTimeService = {
			now: 0,
			get date() {
				return new Date(mockTimeService.now);
			},
		};

		mockRedisGet = undefined;
		mockRedisSet = undefined;
		const mockRedisClient = {
			get(key: string) {
				if (mockRedisGet) return Promise.resolve(mockRedisGet(key));
				else return Promise.resolve(null);
			},
			set(...args: unknown[]): Promise<void> {
				if (mockRedisSet) mockRedisSet(args);
				return Promise.resolve();
			},
		} as unknown as Redis.Redis;

		mockEnvironment = Object.create(process.env);
		mockEnvironment.NODE_ENV = 'production';
		const mockEnvService = {
			env: mockEnvironment,
		};

		loggedMessages = [];
		const mockLogService = {
			getLogger() {
				return {
					createSubLogger(context: string, color?: KEYWORD) {
						return mockLogService.getLogger(context, color);
					},
					error(...data: unknown[]) {
						loggedMessages.push({ level: 'error', data });
					},
					warn(...data: unknown[]) {
						loggedMessages.push({ level: 'warn', data });
					},
					succ(...data: unknown[]) {
						loggedMessages.push({ level: 'succ', data });
					},
					debug(...data: unknown[]) {
						loggedMessages.push({ level: 'debug', data });
					},
					info(...data: unknown[]) {
						loggedMessages.push({ level: 'info', data });
					},
				};
			},
		} as unknown as LoggerService;

		let service: SkRateLimiterService | undefined = undefined;
		serviceUnderTest = () => {
			return service ??= new SkRateLimiterService(mockTimeService, mockRedisClient, mockLogService, mockEnvService);
		};
	});

	function expectNoUnhandledErrors() {
		const unhandledErrors = loggedMessages.filter(m => m.level === 'error');
		if (unhandledErrors.length > 0) {
			throw new Error(`Test failed: got unhandled errors ${unhandledErrors.join('\n')}`);
		}
	}

	describe('limit', () => {
		const actor = 'actor';
		const key = 'test';

		let counter: LimitCounter | undefined = undefined;
		let minCounter: LimitCounter | undefined = undefined;

		beforeEach(() => {
			counter = undefined;
			minCounter = undefined;

			mockRedisGet = (key: string) => {
				if (key === 'rl_actor_test_bucket' && counter) {
					return JSON.stringify(counter);
				}

				if (key === 'rl_actor_test_min' && minCounter) {
					return JSON.stringify(minCounter);
				}

				return null;
			};

			mockRedisSet = (args: unknown[]) => {
				const [key, value] = args;

				if (key === 'rl_actor_test_bucket') {
					if (value == null) counter = undefined;
					else if (typeof(value) === 'string') counter = JSON.parse(value);
					else throw new Error('invalid redis call');
				}

				if (key === 'rl_actor_test_min') {
					if (value == null) minCounter = undefined;
					else if (typeof(value) === 'string') minCounter = JSON.parse(value);
					else throw new Error('invalid redis call');
				}
			};
		});

		it('should bypass in non-production', async () => {
			mockEnvironment.NODE_ENV = 'test';

			const info = await serviceUnderTest().limit({ key: 'l', type: undefined, max: 0 }, 'actor');

			expect(info.blocked).toBeFalsy();
			expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
			expect(info.resetSec).toBe(0);
			expect(info.resetMs).toBe(0);
			expect(info.fullResetSec).toBe(0);
			expect(info.fullResetMs).toBe(0);
		});

		describe('with bucket limit', () => {
			let limit: Keyed<BucketRateLimit> = null!;

			beforeEach(() => {
				limit = {
					type: 'bucket',
					key: 'test',
					size: 1,
				};
			});

			it('should allow when limit is not reached', async () => {
				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should not error when allowed', async () => {
				await serviceUnderTest().limit(limit, actor);

				expectNoUnhandledErrors();
			});

			it('should return correct info when allowed', async () => {
				limit.size = 2;
				counter = { c: 1, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(2);
				expect(info.fullResetMs).toBe(2000);
			});

			it('should increment counter when called', async () => {
				await serviceUnderTest().limit(limit, actor);

				expect(counter).not.toBeUndefined();
				expect(counter?.c).toBe(1);
			});

			it('should set timestamp when called', async () => {
				mockTimeService.now = 1000;

				await serviceUnderTest().limit(limit, actor);

				expect(counter).not.toBeUndefined();
				expect(counter?.t).toBe(1000);
			});

			it('should decrement counter when dripRate has passed', async () => {
				counter = { c: 2, t: 0 };
				mockTimeService.now = 2000;

				await serviceUnderTest().limit(limit, actor);

				expect(counter).not.toBeUndefined();
				expect(counter?.c).toBe(1); // 2 (starting) - 2 (2x1 drip) + 1 (call) = 1
			});

			it('should decrement counter by dripSize', async () => {
				counter = { c: 2, t: 0 };
				limit.dripSize = 2;
				mockTimeService.now = 1000;

				await serviceUnderTest().limit(limit, actor);

				expect(counter).not.toBeUndefined();
				expect(counter?.c).toBe(1); // 2 (starting) - 2 (1x2 drip) + 1 (call) = 1
			});

			it('should maintain counter between calls over time', async () => {
				limit.size = 5;

				await serviceUnderTest().limit(limit, actor); // 0 + 1 = 1
				mockTimeService.now += 1000; // 1 - 1 = 0
				await serviceUnderTest().limit(limit, actor); // 0 + 1 = 1
				await serviceUnderTest().limit(limit, actor); // 1 + 1 = 2
				await serviceUnderTest().limit(limit, actor); // 2 + 1 = 3
				mockTimeService.now += 1000; // 3 - 1 = 2
				mockTimeService.now += 1000; // 2 - 1 = 1
				await serviceUnderTest().limit(limit, actor); // 1 + 1 = 2

				expect(counter?.c).toBe(2);
				expect(counter?.t).toBe(3000);
			});

			it('should log error and continue when update fails', async () => {
				mockRedisSet = () => {
					throw new Error('test error');
				};

				await serviceUnderTest().limit(limit, actor);

				const matchingError = loggedMessages
					.find(m => m.level === 'error' && m.data
						.some(d => typeof(d) === 'string' && d.includes('Failed to update limit')));
				expect(matchingError).toBeTruthy();
			});

			it('should block when bucket is filled', async () => {
				counter = { c: 1, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
			});

			it('should calculate correct info when blocked', async () => {
				counter = { c: 1, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(1);
				expect(info.fullResetMs).toBe(1000);
			});

			it('should allow when bucket is filled but should drip', async () => {
				counter = { c: 1, t: 0 };
				mockTimeService.now = 1000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should scale limit by factor', async () => {
				counter = { c: 1, t: 0 };

				const i1 = await serviceUnderTest().limit(limit, actor, 0.5); // 1 + 1 = 2
				const i2 = await serviceUnderTest().limit(limit, actor, 0.5); // 2 + 1 = 3

				expect(i1.blocked).toBeFalsy();
				expect(i2.blocked).toBeTruthy();
			});

			it('should set key expiration', async () => {
				const mock = jest.fn(mockRedisSet);
				mockRedisSet = mock;

				await serviceUnderTest().limit(limit, actor);

				expect(mock).toHaveBeenCalledWith(['rl_actor_test_bucket', '{"t":0,"c":1}', 'EX', 1]);
			});

			it('should not increment when already blocked', async () => {
				counter = { c: 1, t: 0 };
				mockTimeService.now += 100;

				await serviceUnderTest().limit(limit, actor);

				expect(counter?.c).toBe(1);
				expect(counter?.t).toBe(0);
			});

			it('should skip if factor is zero', async () => {
				const info = await serviceUnderTest().limit(limit, actor, 0);

				expect(info.blocked).toBeFalsy();
				expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
			});

			it('should throw if factor is negative', async () => {
				const promise = serviceUnderTest().limit(limit, actor, -1);

				await expect(promise).rejects.toThrow(/factor is zero or negative/);
			});

			it('should throw if size is zero', async () => {
				limit.size = 0;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/size is less than 1/);
			});

			it('should throw if size is negative', async () => {
				limit.size = -1;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/size is less than 1/);
			});

			it('should throw if size is fraction', async () => {
				limit.size = 0.5;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/size is less than 1/);
			});

			it('should throw if dripRate is zero', async () => {
				limit.dripRate = 0;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripRate is less than 1/);
			});

			it('should throw if dripRate is negative', async () => {
				limit.dripRate = -1;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripRate is less than 1/);
			});

			it('should throw if dripRate is fraction', async () => {
				limit.dripRate = 0.5;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripRate is less than 1/);
			});

			it('should throw if dripSize is zero', async () => {
				limit.dripSize = 0;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripSize is less than 1/);
			});

			it('should throw if dripSize is negative', async () => {
				limit.dripSize = -1;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripSize is less than 1/);
			});

			it('should throw if dripSize is fraction', async () => {
				limit.dripSize = 0.5;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripSize is less than 1/);
			});
		});

		describe('with min interval', () => {
			let limit: Keyed<LegacyRateLimit> = null!;

			beforeEach(() => {
				limit = {
					type: undefined,
					key,
					minInterval: 1000,
				};
			});

			it('should allow when limit is not reached', async () => {
				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should not error when allowed', async () => {
				await serviceUnderTest().limit(limit, actor);

				expectNoUnhandledErrors();
			});

			it('should calculate correct info when allowed', async () => {
				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(1);
				expect(info.fullResetMs).toBe(1000);
			});

			it('should increment counter when called', async () => {
				await serviceUnderTest().limit(limit, actor);

				expect(minCounter).not.toBeUndefined();
				expect(minCounter?.c).toBe(1);
			});

			it('should set timestamp when called', async () => {
				mockTimeService.now = 1000;

				await serviceUnderTest().limit(limit, actor);

				expect(minCounter).not.toBeUndefined();
				expect(minCounter?.t).toBe(1000);
			});

			it('should decrement counter when minInterval has passed', async () => {
				minCounter = { c: 1, t: 0 };
				mockTimeService.now = 1000;

				await serviceUnderTest().limit(limit, actor);

				expect(minCounter).not.toBeUndefined();
				expect(minCounter?.c).toBe(1); // 1 (starting) - 1 (interval) + 1 (call) = 1
			});

			it('should reset counter entirely', async () => {
				minCounter = { c: 2, t: 0 };
				mockTimeService.now = 1000;

				await serviceUnderTest().limit(limit, actor);

				expect(minCounter).not.toBeUndefined();
				expect(minCounter?.c).toBe(1); // 2 (starting) - 2 (interval) + 1 (call) = 1
			});

			it('should maintain counter between calls over time', async () => {
				await serviceUnderTest().limit(limit, actor); // 0 + 1 = 1
				mockTimeService.now += 1000; // 1 - 1 = 0
				await serviceUnderTest().limit(limit, actor); // 0 + 1 = 1
				await serviceUnderTest().limit(limit, actor); // blocked
				await serviceUnderTest().limit(limit, actor); // blocked
				mockTimeService.now += 1000; // 1 - 1 = 0
				mockTimeService.now += 1000; // 0 - 1 = 0
				await serviceUnderTest().limit(limit, actor); // 0 + 1 = 1

				expect(minCounter?.c).toBe(1);
				expect(minCounter?.t).toBe(3000);
			});

			it('should log error and continue when update fails', async () => {
				mockRedisSet = () => {
					throw new Error('test error');
				};

				await serviceUnderTest().limit(limit, actor);

				const matchingError = loggedMessages
					.find(m => m.level === 'error' && m.data
						.some(d => typeof(d) === 'string' && d.includes('Failed to update limit')));
				expect(matchingError).toBeTruthy();
			});

			it('should block when interval exceeded', async () => {
				minCounter = { c: 1, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
			});

			it('should calculate correct info when blocked', async () => {
				minCounter = { c: 1, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(1);
				expect(info.fullResetMs).toBe(1000);
			});

			it('should allow when bucket is filled but interval has passed', async () => {
				minCounter = { c: 1, t: 0 };
				mockTimeService.now = 1000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should scale interval by factor', async () => {
				minCounter = { c: 1, t: 0 };
				mockTimeService.now += 500;

				const info = await serviceUnderTest().limit(limit, actor, 0.5);

				expect(info.blocked).toBeFalsy();
			});

			it('should set key expiration', async () => {
				const mock = jest.fn(mockRedisSet);
				mockRedisSet = mock;

				await serviceUnderTest().limit(limit, actor);

				expect(mock).toHaveBeenCalledWith(['rl_actor_test_min', '{"t":0,"c":1}', 'EX', 1]);
			});

			it('should not increment when already blocked', async () => {
				minCounter = { c: 1, t: 0 };
				mockTimeService.now += 100;

				await serviceUnderTest().limit(limit, actor);

				expect(minCounter?.c).toBe(1);
				expect(minCounter?.t).toBe(0);
			});

			it('should skip if factor is zero', async () => {
				const info = await serviceUnderTest().limit(limit, actor, 0);

				expect(info.blocked).toBeFalsy();
				expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
			});

			it('should throw if factor is negative', async () => {
				const promise = serviceUnderTest().limit(limit, actor, -1);

				await expect(promise).rejects.toThrow(/factor is zero or negative/);
			});

			it('should skip if minInterval is zero', async () => {
				limit.minInterval = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
				expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
			});

			it('should throw if minInterval is negative', async () => {
				limit.minInterval = -1;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/minInterval is negative/);
			});
		});

		describe('with legacy limit', () => {
			let limit: Keyed<LegacyRateLimit> = null!;

			beforeEach(() => {
				limit = {
					type: undefined,
					key,
					max: 1,
					duration: 1000,
				};
			});

			it('should allow when limit is not reached', async () => {
				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should not error when allowed', async () => {
				await serviceUnderTest().limit(limit, actor);

				expectNoUnhandledErrors();
			});

			it('should infer dripRate from duration', async () => {
				limit.max = 10;
				limit.duration = 10000;
				counter = { c: 10, t: 0 };

				const i1 = await serviceUnderTest().limit(limit, actor);
				mockTimeService.now += 1000;
				const i2 = await serviceUnderTest().limit(limit, actor);
				mockTimeService.now += 2000;
				const i3 = await serviceUnderTest().limit(limit, actor);
				const i4 = await serviceUnderTest().limit(limit, actor);
				const i5 = await serviceUnderTest().limit(limit, actor);
				mockTimeService.now += 2000;
				const i6 = await serviceUnderTest().limit(limit, actor);

				expect(i1.blocked).toBeTruthy();
				expect(i2.blocked).toBeFalsy();
				expect(i3.blocked).toBeFalsy();
				expect(i4.blocked).toBeFalsy();
				expect(i5.blocked).toBeTruthy();
				expect(i6.blocked).toBeFalsy();
			});

			it('should calculate correct info when allowed', async () => {
				limit.max = 10;
				limit.duration = 10000;
				counter = { c: 10, t: 0 };
				mockTimeService.now += 2000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(1);
				expect(info.resetSec).toBe(0);
				expect(info.resetMs).toBe(0);
				expect(info.fullResetSec).toBe(9);
				expect(info.fullResetMs).toBe(9000);
			});

			it('should calculate correct info when blocked', async () => {
				limit.max = 10;
				limit.duration = 10000;
				counter = { c: 10, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(10);
				expect(info.fullResetMs).toBe(10000);
			});

			it('should allow when bucket is filled but interval has passed', async () => {
				counter = { c: 10, t: 0 };
				mockTimeService.now = 1000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
			});

			it('should scale limit by factor', async () => {
				counter = { c: 10, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor, 0.5); // 10 + 1 = 11

				expect(info.blocked).toBeTruthy();
			});

			it('should set key expiration', async () => {
				const mock = jest.fn(mockRedisSet);
				mockRedisSet = mock;

				await serviceUnderTest().limit(limit, actor);

				expect(mock).toHaveBeenCalledWith(['rl_actor_test_bucket', '{"t":0,"c":1}', 'EX', 1]);
			});

			it('should not increment when already blocked', async () => {
				counter = { c: 1, t: 0 };
				mockTimeService.now += 100;

				await serviceUnderTest().limit(limit, actor);

				expect(counter?.c).toBe(1);
				expect(counter?.t).toBe(0);
			});

			it('should not allow dripRate to be lower than 0', async () => {
				// real-world case; taken from StreamingApiServerService
				limit.max = 4096;
				limit.duration = 2000;
				counter = { c: 4096, t: 0 };

				const i1 = await serviceUnderTest().limit(limit, actor);
				mockTimeService.now = 1;
				const i2 = await serviceUnderTest().limit(limit, actor);

				expect(i1.blocked).toBeTruthy();
				expect(i2.blocked).toBeFalsy();
			});

			it('should skip if factor is zero', async () => {
				const info = await serviceUnderTest().limit(limit, actor, 0);

				expect(info.blocked).toBeFalsy();
				expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
			});

			it('should throw if factor is negative', async () => {
				const promise = serviceUnderTest().limit(limit, actor, -1);

				await expect(promise).rejects.toThrow(/factor is zero or negative/);
			});

			it('should throw if max is zero', async () => {
				limit.max = 0;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/size is less than 1/);
			});

			it('should throw if max is negative', async () => {
				limit.max = -1;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/size is less than 1/);
			});
		});

		describe('with legacy limit and min interval', () => {
			let limit: Keyed<LegacyRateLimit> = null!;

			beforeEach(() => {
				limit = {
					type: undefined,
					key,
					max: 5,
					duration: 5000,
					minInterval: 1000,
				};
			});

			it('should allow when limit is not reached', async () => {
				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should not error when allowed', async () => {
				await serviceUnderTest().limit(limit, actor);

				expectNoUnhandledErrors();
			});

			it('should block when limit exceeded', async () => {
				counter = { c: 5, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
			});

			it('should block when minInterval exceeded', async () => {
				minCounter = { c: 1, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
			});

			it('should calculate correct info when allowed', async () => {
				counter = { c: 1, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(2);
				expect(info.fullResetMs).toBe(2000);
			});

			it('should calculate correct info when blocked by limit', async () => {
				counter = { c: 5, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(5);
				expect(info.fullResetMs).toBe(5000);
			});

			it('should calculate correct info when blocked by minInterval', async () => {
				minCounter = { c: 1, t: 0 };

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(1);
				expect(info.fullResetMs).toBe(1000);
			});

			it('should allow when counter is filled but interval has passed', async () => {
				counter = { c: 5, t: 0 };
				mockTimeService.now = 1000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should allow when minCounter is filled but interval has passed', async () => {
				minCounter = { c: 1, t: 0 };
				mockTimeService.now = 1000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should scale limit and interval by factor', async () => {
				counter = { c: 5, t: 0 };
				minCounter = { c: 1, t: 0 };
				mockTimeService.now += 500;

				const info = await serviceUnderTest().limit(limit, actor, 0.5);

				expect(info.blocked).toBeFalsy();
			});

			it('should set key expiration', async () => {
				const mock = jest.fn(mockRedisSet);
				mockRedisSet = mock;

				await serviceUnderTest().limit(limit, actor);

				expect(mock).toHaveBeenCalledWith(['rl_actor_test_bucket', '{"t":0,"c":1}', 'EX', 1]);
				expect(mock).toHaveBeenCalledWith(['rl_actor_test_min', '{"t":0,"c":1}', 'EX', 1]);
			});

			it('should not increment when already blocked', async () => {
				counter = { c: 5, t: 0 };
				minCounter = { c: 1, t: 0 };
				mockTimeService.now += 100;

				await serviceUnderTest().limit(limit, actor);

				expect(counter?.c).toBe(5);
				expect(counter?.t).toBe(0);
				expect(minCounter?.c).toBe(1);
				expect(minCounter?.t).toBe(0);
			});
		});
	});
});
