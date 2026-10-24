/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Request headers that carry credentials. They must never be persisted
 * (for example into drive_file.requestHeaders), because moderators can read
 * stored headers and would be able to take over the account.
 */
export const sensitiveRequestHeaders: ReadonlySet<string> = new Set([
	'authorization',
	'proxy-authorization',
	'cookie',
]);

/**
 * Returns a shallow copy of the given request headers without any credential
 * headers. Header names are compared case-insensitively. The input is never
 * mutated, so it is safe to pass the live request.headers object.
 */
export function redactRequestHeaders<T>(headers: Record<string, T> | null | undefined): Record<string, T> | null {
	if (headers == null) return null;

	// Object.fromEntries defines own properties, so a "__proto__" header stays plain data.
	return Object.fromEntries(
		Object.entries(headers).filter(([name]) => !sensitiveRequestHeaders.has(name.toLowerCase())),
	);
}
