/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { ApiError } from '@/server/api/error.js';
import { EnvService } from '@/core/EnvService.js';
import { getBaseUrl } from '@/server/api/mastodon/MastodonClientService.js';

@Injectable()
export class MastodonLogger {
	public readonly logger: Logger;

	constructor(
		@Inject(EnvService)
		private readonly envService: EnvService,

		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('masto-api');
	}

	public error(request: FastifyRequest, error: MastodonError, status: number): void {
		if ((status < 400 && status > 499) || this.envService.env.NODE_ENV === 'development') {
			const path = new URL(request.url, getBaseUrl(request)).pathname;
			this.logger.error(`Error in mastodon endpoint ${request.method} ${path}:`, error);
		}
	}
}

// TODO move elsewhere
export interface MastodonError {
	error: string;
	error_description?: string;
}

export function getErrorData(error: unknown): MastodonError {
	// Axios wraps errors from the backend
	error = unpackAxiosError(error);

	if (!error || typeof(error) !== 'object') {
		return {
			error: 'UNKNOWN_ERROR',
			error_description: String(error),
		};
	}

	if (error instanceof ApiError) {
		return convertApiError(error);
	}

	if ('code' in error && typeof (error.code) === 'string') {
		if ('message' in error && typeof (error.message) === 'string') {
			return convertApiError(error as ApiError);
		}
	}

	if (error instanceof Error) {
		return convertGenericError(error);
	}

	return convertUnknownError(error);
}

function unpackAxiosError(error: unknown): unknown {
	if (error && typeof(error) === 'object') {
		if ('response' in error && error.response && typeof (error.response) === 'object') {
			if ('data' in error.response && error.response.data && typeof (error.response.data) === 'object') {
				if ('error' in error.response.data && error.response.data.error && typeof(error.response.data.error) === 'object') {
					return error.response.data.error;
				}

				return error.response.data;
			}

			// No data - this is a fallback to avoid leaking request/response details in the error
			return undefined;
		}
	}

	return error;
}

function convertApiError(apiError: ApiError): MastodonError {
	const mastoError: MastodonError & Partial<ApiError> = {
		error: apiError.code,
		error_description: apiError.message,
		...apiError,
	};

	delete mastoError.code;
	delete mastoError.message;
	delete mastoError.httpStatusCode;

	return mastoError;
}

function convertUnknownError(data: object = {}): MastodonError {
	return Object.assign({}, data, {
		error: 'INTERNAL_ERROR',
		error_description: 'Internal error occurred. Please contact us if the error persists.',
		id: '5d37dbcb-891e-41ca-a3d6-e690c97775ac',
		kind: 'server',
	});
}

function convertGenericError(error: Error): MastodonError {
	const mastoError: MastodonError & Partial<Error> = {
		error: 'INTERNAL_ERROR',
		error_description: String(error),
		...error,
	};

	delete mastoError.name;
	delete mastoError.message;
	delete mastoError.stack;

	return mastoError;
}

export function getErrorStatus(error: unknown): number {
	if (error && typeof(error) === 'object') {
		// Axios wraps errors from the backend
		if ('response' in error && typeof (error.response) === 'object' && error.response) {
			if ('status' in error.response && typeof(error.response.status) === 'number') {
				return error.response.status;
			}
		}

		if ('httpStatusCode' in error && typeof(error.httpStatusCode) === 'number') {
			return error.httpStatusCode;
		}
	}

	return 500;
}
