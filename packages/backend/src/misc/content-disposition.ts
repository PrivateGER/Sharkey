/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export async function contentDisposition(type: 'inline' | 'attachment', filename: string): Promise<string> {
	// Lazy-import to fix jest error about require(esm) cycles
	const { create } = await import('content-disposition');

	const fallback = filename.replace(/[^\w.-]/g, '_');
	return create(filename, { type, fallback });
}
