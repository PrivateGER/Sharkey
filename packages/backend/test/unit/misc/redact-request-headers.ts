/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from '@jest/globals';
import { redactRequestHeaders } from '@/misc/redact-request-headers.js';

describe(redactRequestHeaders, () => {
	it('returns null for missing headers', () => {
		expect(redactRequestHeaders(null)).toBeNull();
		expect(redactRequestHeaders(undefined)).toBeNull();
	});

	it('removes the API token and session cookies but keeps other headers', () => {
		const headers = {
			'authorization': 'Bearer secret-token',
			'proxy-authorization': 'Basic Zm9vOmJhcg==',
			'cookie': 'token=secret-session',
			'user-agent': 'megalodon',
			'x-forwarded-for': '203.0.113.1',
			'content-type': 'multipart/form-data; boundary=abc',
		};

		expect(redactRequestHeaders(headers)).toStrictEqual({
			'user-agent': 'megalodon',
			'x-forwarded-for': '203.0.113.1',
			'content-type': 'multipart/form-data; boundary=abc',
		});
	});

	it('matches credential header names case-insensitively', () => {
		const redacted = redactRequestHeaders({
			Authorization: 'Bearer a',
			AUTHORIZATION: 'Bearer b',
			Cookie: 'c',
			'Proxy-Authorization': 'd',
			Accept: '*/*',
		});

		expect(redacted).toStrictEqual({ Accept: '*/*' });
		expect(JSON.stringify(redacted)).not.toMatch(/Bearer|"c"|"d"/);
	});

	it('does not mutate the live request headers', () => {
		const headers = { authorization: 'Bearer secret-token', host: 'example.com' };

		const redacted = redactRequestHeaders(headers);

		expect(headers).toStrictEqual({ authorization: 'Bearer secret-token', host: 'example.com' });
		expect(redacted).not.toBe(headers);
		expect(redacted).toStrictEqual({ host: 'example.com' });
	});

	it('keeps multi-valued headers and does not treat look-alike names as credentials', () => {
		const redacted = redactRequestHeaders<string | string[]>({
			'x-authorization-hint': 'not a credential',
			'set-cookie': ['a=1', 'b=2'],
			'cookie': ['session=1', 'other=2'],
		});

		expect(redacted).toStrictEqual({
			'x-authorization-hint': 'not a credential',
			'set-cookie': ['a=1', 'b=2'],
		});
	});

	it('ignores inherited properties and keeps a __proto__ header as plain data', () => {
		const headers = JSON.parse('{"__proto__": {"authorization": "Bearer polluted"}, "accept": "*/*"}') as Record<string, unknown>;

		const redacted = redactRequestHeaders(headers);

		expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
		expect((redacted as Record<string, unknown>).authorization).toBeUndefined();
		expect(JSON.parse(JSON.stringify(redacted))).toStrictEqual(JSON.parse('{"__proto__": {"authorization": "Bearer polluted"}, "accept": "*/*"}'));
	});
});
