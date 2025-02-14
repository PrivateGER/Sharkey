/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import Logger, { Data } from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';

@Injectable()
export class MastodonLogger {
	public readonly logger: Logger;

	constructor(loggerService: LoggerService) {
		this.logger = loggerService.getLogger('masto-api');
	}

	public error(endpoint: string, error: Data): void {
		this.logger.error(`Error in mastodon API endpoint ${endpoint}:`, error);
	}
}

export function getErrorData(error: unknown): Data {
	if (error == null) return {};
	if (typeof(error) === 'string') return error;
	if (typeof(error) === 'object') {
		if ('response' in error) {
			if (typeof(error.response) === 'object' && error.response) {
				if ('data' in error.response) {
					if (typeof(error.response.data) === 'object' && error.response.data) {
						return error.response.data as Record<string, unknown>;
					}
				}
			}
		}
		return error as Record<string, unknown>;
	}
	return { error };
}
