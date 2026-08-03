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
	const testUser = 'https://sharkey.test/@user';

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

	it('should accept a valid url in response body', async () => {
		httpRequestService.send.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			text: async () => `<link href="${testUser}" rel="me"></a>`
		} as Response);
		const verifiedLinks = await verifyFieldLinks(testFields, [testUser], httpRequestService);

		expect(verifiedLinks).toHaveLength(1);
		expect(verifiedLinks[0]).toEqual(testUrl);
	})

	it('should accept a valid url in headers', async () => {
		httpRequestService.send.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers([['link', `<${testUser}>; rel="me"`]]),
		} as Response);
		const verifiedLinks = await verifyFieldLinks(testFields, [testUser], httpRequestService);

		expect(verifiedLinks).toHaveLength(1);
		expect(verifiedLinks[0]).toEqual(testUrl);
	});
});
