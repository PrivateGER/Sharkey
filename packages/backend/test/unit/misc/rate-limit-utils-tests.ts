/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest } from '@jest/globals';
import { Mock } from 'jest-mock';
import type { FastifyReply } from 'fastify';
import { LimitInfo, sendRateLimitHeaders } from '@/misc/rate-limit-utils.js';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe(sendRateLimitHeaders, () => {
	let mockHeader: Mock<((name: string, value: unknown) => void)> = null!;
	let mockReply: FastifyReply = null!;
	let fakeInfo: LimitInfo = null!;

	beforeEach(() => {
		mockHeader = jest.fn<((name: string, value: unknown) => void)>();
		mockReply = {
			header: mockHeader,
		} as unknown as FastifyReply;
		fakeInfo = {
			blocked: false,
			remaining: 1,
			resetSec: 1,
			resetMs: 567,
			fullResetSec: 10,
			fullResetMs: 9876,
		};
	});

	it('should send X-RateLimit-Clear', () => {
		sendRateLimitHeaders(mockReply, fakeInfo);

		expect(mockHeader).toHaveBeenCalledWith('X-RateLimit-Clear', '9.876');
	});

	it('should send X-RateLimit-Remaining', () => {
		sendRateLimitHeaders(mockReply, fakeInfo);

		expect(mockHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '1');
	});

	describe('when limit is blocked', () => {
		it('should send X-RateLimit-Reset', () => {
			fakeInfo.blocked = true;

			sendRateLimitHeaders(mockReply, fakeInfo);

			expect(mockHeader).toHaveBeenCalledWith('X-RateLimit-Reset', '0.567');
		});

		it('should send Retry-After', () => {
			fakeInfo.blocked = true;

			sendRateLimitHeaders(mockReply, fakeInfo);

			expect(mockHeader).toHaveBeenCalledWith('Retry-After', '1');
		});
	});
});
