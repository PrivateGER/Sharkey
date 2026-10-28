/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from '@jest/globals';
import { contentDisposition } from '@/misc/content-disposition.js';

describe('misc:content-disposition', () => {
	test('inline', async () => {
		expect(await contentDisposition('inline', 'foo bar')).toBe('inline; filename=foo_bar; filename*=UTF-8\'\'foo%20bar');
	});
	test('attachment', async () => {
		expect(await contentDisposition('attachment', 'foo bar')).toBe('attachment; filename=foo_bar; filename*=UTF-8\'\'foo%20bar');
	});
	test('non ascii', async () => {
		expect(await contentDisposition('attachment', 'ファイル名')).toBe('attachment; filename=_____; filename*=UTF-8\'\'%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB%E5%90%8D');
	});
	test('semi', async () => {
		expect(await contentDisposition('attachment', 'foo;bar')).toBe('attachment; filename=foo_bar; filename*=UTF-8\'\'foo%3Bbar');
	});
	test('empty', async () => {
		expect(await contentDisposition('attachment', '')).toBe('attachment; filename=\"\"');
	});
});
