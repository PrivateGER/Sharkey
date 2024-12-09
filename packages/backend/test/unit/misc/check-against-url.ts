/*
 * SPDX-FileCopyrightText: dakkar and sharkey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from '@jest/globals';
import type { IObject } from '@/core/activitypub/type.js';
import { assertActivityMatchesUrls } from '@/core/activitypub/misc/check-against-url.js';

function assertOne(activity: IObject, good = 'http://good') {
	// return a function so we can use `.toThrow`
	return () => assertActivityMatchesUrls(activity, [good]);
}

describe('assertActivityMatchesUrls', () => {
	it('should throw when no ids are URLs', () => {
		expect(assertOne({ type: 'Test', id: 'bad' }, 'bad')).toThrow(/bad Activity/);
	});

	test('id', () => {
		expect(assertOne({ type: 'Test', id: 'http://bad' })).toThrow(/bad Activity/);
		expect(assertOne({ type: 'Test', id: 'http://good' })).not.toThrow();
	});

	test('simple url', () => {
		expect(assertOne({ type: 'Test', url: 'http://bad' })).toThrow(/bad Activity/);
		expect(assertOne({ type: 'Test', url: 'http://good' })).not.toThrow();
	});

	test('array of urls', () => {
		expect(assertOne({ type: 'Test', url: ['http://bad'] })).toThrow(/bad Activity/);
		expect(assertOne({ type: 'Test', url: ['http://bad', 'http://other'] })).toThrow(/bad Activity/);
		expect(assertOne({ type: 'Test', url: ['http://good'] })).not.toThrow();
		expect(assertOne({ type: 'Test', url: ['http://bad', 'http://good'] })).not.toThrow();
	});

	test('array of objects', () => {
		expect(assertOne({ type: 'Test', url: [{ type: 'Test', href: 'http://bad' }] })).toThrow(/bad Activity/);
		expect(assertOne({ type: 'Test', url: [{ type: 'Test', href: 'http://bad' }, { type: 'Test', href: 'http://other' }] })).toThrow(/bad Activity/);
		expect(assertOne({ type: 'Test', url: [{ type: 'Test', href: 'http://good' }] })).not.toThrow();
		expect(assertOne({ type: 'Test', url: [{ type: 'Test', href: 'http://bad' }, { type: 'Test', href: 'http://good' }] })).not.toThrow();
	});

	test('mixed array', () => {
		expect(assertOne({ type: 'Test', url: [{ type: 'Test', href: 'http://bad' }, 'http://other'] })).toThrow(/bad Activity/);
		expect(assertOne({ type: 'Test', url: [{ type: 'Test', href: 'http://bad' }, 'http://good'] })).not.toThrow();
		expect(assertOne({ type: 'Test', url: ['http://bad', { type: 'Test', href: 'http://good' }] })).not.toThrow();
	});

	test('id and url', () => {
		expect(assertOne({ type: 'Test', id: 'http://other', url: 'http://bad' })).toThrow(/bad Activity/);
		expect(assertOne({ type: 'Test', id: 'http://bad', url: 'http://good' })).not.toThrow();
		expect(assertOne({ type: 'Test', id: 'http://good', url: 'http://bad' })).not.toThrow();
	});
});
