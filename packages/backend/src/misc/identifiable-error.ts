/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ID付きエラー
 */
export class IdentifiableError extends Error {
	public message: string;
	public id: string;

	/**
	 * Indicates that this is a temporary error that may be cleared by retrying
	 */
	public readonly isRetryable: boolean;

	constructor(id: string, message?: string, isRetryable = false) {
		super(message);
		this.message = message ?? '';
		this.id = id;
		this.isRetryable = isRetryable;
	}
}
