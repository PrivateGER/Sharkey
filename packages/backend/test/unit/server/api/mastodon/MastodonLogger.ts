/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ApiError } from '@/server/api/error.js';
import { AuthenticationError } from '@/server/api/AuthenticateService.js';
import { getErrorData, getErrorException, getErrorStatus } from '@/server/api/mastodon/MastodonLogger.js';

describe('getErrorException', () => {
	it('should not treat a client ApiError as a server exception', () => {
		const error = new ApiError({
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: '24fcbfc6-2e37-42b6-8388-c29b3861a08d',
			kind: 'client',
			httpStatusCode: 404,
		});

		expect(getErrorException(error)).toBeNull();
	});

	it('should treat an internal ApiError as a server exception', () => {
		const error = new ApiError();

		expect(getErrorException(error)).toBe(error);
	});

	it('should treat an ApiError without a status as a server exception', () => {
		const error = new ApiError({
			message: 'Something is wrong.',
			code: 'SOMETHING_WRONG',
			id: '7a1c4b0e-6f0e-4a57-9a52-3c1a2b6d8e11',
		});

		expect(getErrorException(error)).toBe(error);
	});

	it('should treat an unexpected error as a server exception', () => {
		const error = new TypeError('boom');

		expect(getErrorException(error)).toBe(error);
	});
});

describe('a rejected token', () => {
	const error = new AuthenticationError('invalid signature');

	it('should be reported as unauthorized', () => {
		expect(getErrorStatus(error)).toBe(401);
	});

	it('should not expose the internal reason', () => {
		const data = getErrorData(error);

		expect(data.error).toBe('AUTHENTICATION_FAILED');
		expect(data.error_description).not.toContain('invalid signature');
	});
});
