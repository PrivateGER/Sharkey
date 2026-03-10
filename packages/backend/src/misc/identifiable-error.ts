/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ID付きエラー
 */
export class IdentifiableError extends Error {
	// Fix the error name in stack traces - https://stackoverflow.com/a/71573071
	override name = this.constructor.name;

	public message: string;
	public id: string;

	/**
	 * Indicates that this is a temporary error that may be cleared by retrying
	 */
	public readonly isRetryable: boolean;

	constructor(id: string, message?: string, isRetryable = false, cause?: unknown) {
		super(message, cause ? { cause } : undefined);
		this.message = message ?? '';
		this.id = id;
		this.isRetryable = isRetryable;
	}
}

/**
 * Basic type guard for IdentifiableError.
 * Accepts unknown, so it's usable in catch blocks.
 */
export function isIdentifiableError(error: unknown, id?: string): error is IdentifiableError {
	if (error instanceof IdentifiableError) {
		return id == null || id === error.id;
	}
	return false;
}

/**
 * Standard error codes to reference throughout the app
 */
export const errorCodes = {
	/** User has been deleted (hard or soft deleted) */
	userDeleted: '4cac9436-baa3-4955-a368-7628aea676cf',

	/** User is suspended (directly or by instance) */
	userSuspended: '1e56d624-737f-48e4-beb6-0bdddb9fa809',

	/** User is blocked by the target user(s) */
	userBlocked: '3338392a-f764-498d-8855-db939dcf8c48',

	/** User was expected to be remote, but was local instead. */
	userNotRemote: 'aeac1339-2550-4521-a8e3-781f06d98656',

	/** User was expected to be local, but was remote instead. */
	userNotLocal: 'feb908c1-d507-4157-9b44-2fa5540e2ad8',

	/** User has no valid featured collection (not defined, invalid, etc) */
	noFeaturedCollection: '2aa4766e-b7d8-4291-a671-56800498b085',
	// WebSocket server encountered an error
	websocketError: '4b277ff0-88f6-4ddc-8960-8058e76b3677',
} as const;
