/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbortError } from 'node-fetch';
import { UnrecoverableError } from 'bullmq';
import { StatusError } from '@/misc/status-error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

/**
 * Returns false if the provided value represents a "permanent" error that cannot be retried.
 * Returns true if the error is retryable, unknown (as all errors are retryable by default), or not an error object.
 */
export function isRetryableError(e: unknown): boolean {
	if (e instanceof StatusError) return e.isRetryable;
	if (e instanceof IdentifiableError) return e.isRetryable;
	if (e instanceof UnrecoverableError) return false;
	if (e instanceof AbortError) return true;
	if (e instanceof Error) return e.name === 'AbortError';
	return true;
}
