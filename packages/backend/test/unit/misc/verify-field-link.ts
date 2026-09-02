/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { Response, Headers } from 'node-fetch';
import { GlobalModule } from '@/GlobalModule.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { CoreModule } from '@/core/CoreModule.js';
import { verifyFieldLinks } from '@/misc/verify-field-link.js';

describe(verifyFieldLinks, () => {
	let app: TestingModule;
	let httpRequestService: jest.Mocked<HttpRequestService>;
	const testUrl = 'https://validation.test';
	const testFields = [{ name: 'test url', value: testUrl }];
	const validProfileUrl = 'https://sharkey.test/@user';
	const invalidProfileUrl = 'https://sharkey.test/@invalid';

	beforeAll(async () => {
		app = await Test.createTestingModule({
			imports: [
				GlobalModule,
				CoreModule,
			],
		})
			.overrideProvider(HttpRequestService).useValue({ send: jest.fn() })
			.compile();

		await app.init();
		app.enableShutdownHooks();

		httpRequestService = app.get(HttpRequestService) as jest.Mocked<HttpRequestService>;
	});

	beforeEach(() => {
		httpRequestService.send.mockClear();
	});

	afterAll(async () => {
		await app.close();
	});

	it('should accept a valid URL in response body', async () => {
		httpRequestService.send.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			text: async () => `<link href="${validProfileUrl}" rel="me"></link>`,
		} as Response);
		const verifiedLinks = await verifyFieldLinks(testFields, [validProfileUrl], httpRequestService);

		expect(verifiedLinks).toHaveLength(1);
		expect(verifiedLinks[0]).toEqual(testUrl);
	});

	it('should accept a valid URL in headers', async () => {
		httpRequestService.send.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers([['link', `<${validProfileUrl}>; rel="me"`]]),
			text: async () => '',
		} as Response);
		const verifiedLinks = await verifyFieldLinks(testFields, [validProfileUrl], httpRequestService);

		expect(verifiedLinks).toHaveLength(1);
		expect(verifiedLinks[0]).toEqual(testUrl);
	});

	it('should reject a user mismatch', async () => {
		httpRequestService.send.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers([['link', `<${invalidProfileUrl}>; rel="me"`]]),
			text: async () => `<link href="${invalidProfileUrl}" rel="me"></link>`,
		} as Response);
		const verifiedLinks = await verifyFieldLinks(testFields, [validProfileUrl], httpRequestService);

		expect(verifiedLinks).toHaveLength(0);
	});

	it('should only accept exact matches', async () => {
		httpRequestService.send.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers([['link', `<${validProfileUrl}2>; rel="me"`]]),
			text: async () => `<link href="${validProfileUrl}2" rel="me"></link>`,
		} as Response);
		const verifiedLinks = await verifyFieldLinks(testFields, [validProfileUrl], httpRequestService);

		expect(verifiedLinks).toHaveLength(0);
	});

	it('should reject malformatted link headers', async () => {
		httpRequestService.send.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers([['link', `${validProfileUrl}; rel="me"`]]),
			text: async () => '',
		} as Response);
		const verifiedLinks = await verifyFieldLinks(testFields, [validProfileUrl], httpRequestService);

		expect(verifiedLinks).toHaveLength(0);
	});

	it('should accept the right out of multiple link headers', async () => {
		httpRequestService.send.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers([['link', `<${invalidProfileUrl}>; rel="me", <${validProfileUrl}>; rel="me"`]]),
			text: async () => '',
		} as Response);
		const verifiedLinks = await verifyFieldLinks(testFields, [validProfileUrl], httpRequestService);

		expect(verifiedLinks).toHaveLength(1);
		expect(verifiedLinks[0]).toEqual(testUrl);
	});

	it('should reject incorrect values for the rel attribute', async () => {
		httpRequestService.send.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers([['link', `<${validProfileUrl}>; rel="invalid"`]]),
			text: async () => `<link href="${validProfileUrl}" rel="invalid"></link>`,
		} as Response);
		const verifiedLinks = await verifyFieldLinks(testFields, [validProfileUrl], httpRequestService);

		expect(verifiedLinks).toHaveLength(0);
	});

	it('should not return duplicate matches', async () => {
		httpRequestService.send.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers([['link', `<${validProfileUrl}>; rel="me", <${validProfileUrl}>; rel="me"`]]),
			text: async () => `<link href="${validProfileUrl}" rel="me"></link><a href="${validProfileUrl}" rel="me"></a>`,
		} as Response);
		const verifiedLinks = await verifyFieldLinks(testFields, [validProfileUrl], httpRequestService);

		expect(verifiedLinks).toHaveLength(1);
		expect(verifiedLinks[0]).toEqual(testUrl);
	});
});
