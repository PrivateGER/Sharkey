/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { UnrecoverableError } from 'bullmq';
import { AbortError } from 'node-fetch';
import { isRetryableError } from '@/misc/is-retryable-error.js';
import { StatusError } from '@/misc/status-error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

describe(isRetryableError, () => {
	it('should return true for retryable StatusError', () => {
		const error = new StatusError('test error', 500);
		const result = isRetryableError(error);
		expect(result).toBeTruthy();
	});

	it('should return false for permanent StatusError', () => {
		const error = new StatusError('test error', 400);
		const result = isRetryableError(error);
		expect(result).toBeFalsy();
	});

	it('should return true for retryable IdentifiableError', () => {
		const error = new IdentifiableError('id', 'message', true);
		const result = isRetryableError(error);
		expect(result).toBeTruthy();
	});

	it('should return false for permanent StatusError', () => {
		const error = new IdentifiableError('id', 'message', false);
		const result = isRetryableError(error);
		expect(result).toBeFalsy();
	});

	it('should return false for UnrecoverableError', () => {
		const error = new UnrecoverableError();
		const result = isRetryableError(error);
		expect(result).toBeFalsy();
	});

	it('should return true for typed AbortError', () => {
		const error = new AbortError();
		const result = isRetryableError(error);
		expect(result).toBeTruthy();
	});

	it('should return true for named AbortError', () => {
		const error = new Error();
		error.name = 'AbortError';

		const result = isRetryableError(error);

		expect(result).toBeTruthy();
	});

	const nonErrorInputs = [
		[null, 'null'],
		[undefined, 'undefined'],
		[0, 'number'],
		['string', 'string'],
		[true, 'boolean'],
		[[], 'array'],
		[{}, 'object'],
	];
	for (const [input, label] of nonErrorInputs) {
		it(`should return true for ${label} input`, () => {
			const result = isRetryableError(input);
			expect(result).toBeTruthy();
		});
	}
});
