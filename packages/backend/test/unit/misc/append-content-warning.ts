/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { appendContentWarning } from '@/misc/append-content-warning.js';

describe(appendContentWarning, () => {
	it('should return additional when original is null', () => {
		const result = appendContentWarning(null, 'additional');

		expect(result).toBe('additional');
	});

	it('should return additional when original is undefined', () => {
		const result = appendContentWarning(undefined, 'additional');

		expect(result).toBe('additional');
	});

	it('should return additional when original is empty', () => {
		const result = appendContentWarning('', 'additional');

		expect(result).toBe('additional');
	});

	it('should return original when additional is empty', () => {
		const result = appendContentWarning('original', '');

		expect(result).toBe('original');
	});

	it('should append additional when it does not exist in original', () => {
		const result = appendContentWarning('original', 'additional');

		expect(result).toBe('original, additional');
	});

	it('should append additional when it exists in original but has preceeding word', () => {
		const result = appendContentWarning('notadditional', 'additional');

		expect(result).toBe('notadditional, additional');
	});

	it('should append additional when it exists in original but has following word', () => {
		const result = appendContentWarning('additionalnot', 'additional');

		expect(result).toBe('additionalnot, additional');
	});

	it('should append additional when it exists in original multiple times but has preceeding or following word', () => {
		const result = appendContentWarning('notadditional additionalnot', 'additional');

		expect(result).toBe('notadditional additionalnot, additional');
	});

	it('should not append additional when it exists in original', () => {
		const result = appendContentWarning('an additional word', 'additional');

		expect(result).toBe('an additional word');
	});

	it('should not append additional when original starts with it', () => {
		const result = appendContentWarning('additional word', 'additional');

		expect(result).toBe('additional word');
	});

	it('should not append additional when original ends with it', () => {
		const result = appendContentWarning('an additional', 'additional');

		expect(result).toBe('an additional');
	});

	it('should not append additional when it appears multiple times', () => {
		const result = appendContentWarning('an additional additional word', 'additional');

		expect(result).toBe('an additional additional word');
	});

	it('should not append additional when it appears multiple times but some have preceeding or following', () => {
		const result = appendContentWarning('a notadditional additional additionalnot word', 'additional');

		expect(result).toBe('a notadditional additional additionalnot word');
	});

	it('should prepend additional when reverse is true', () => {
		const result = appendContentWarning('original', 'additional', true);

		expect(result).toBe('additional, original');
	});
});
