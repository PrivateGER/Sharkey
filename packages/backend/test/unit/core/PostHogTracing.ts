/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createServer, type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { flushPostHogTracing, runDetached, startPostHogTracing, traceUserRequest, withSpan } from '@/core/PostHogTracing.js';

type ExportedSpan = {
	name: string;
	attributes: { key: string; value: { stringValue?: string } }[];
	events?: { attributes: { key: string; value: { stringValue?: string } }[] }[];
	status?: { message?: string };
};

describe('PostHogTracing', () => {
	let server: Server;
	let exported: ExportedSpan[] = [];

	beforeAll(async () => {
		server = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (chunk: Buffer) => chunks.push(chunk));
			req.on('end', () => {
				const raw = Buffer.concat(chunks);
				const body = JSON.parse((req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString());
				for (const resourceSpans of body.resourceSpans) {
					for (const scopeSpans of resourceSpans.scopeSpans) exported.push(...scopeSpans.spans);
				}
				res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
			});
		});
		const listening = Promise.withResolvers<void>();
		server.listen(0, '127.0.0.1', () => listening.resolve());
		await listening.promise;
		const { port } = server.address() as AddressInfo;

		startPostHogTracing({
			tracesUrl: `http://127.0.0.1:${port}/i/v1/traces`,
			projectToken: 'phc_test',
			serviceVersion: 'test',
			environment: 'test',
			instrumentLibraries: false,
			untracedUserIds: ['service'],
		});
	});

	afterAll(async () => {
		const closed = Promise.withResolvers<void>();
		server.close(() => closed.resolve());
		await closed.promise;
	});

	beforeEach(() => {
		exported = [];
	});

	async function exportedNames(): Promise<string[]> {
		await flushPostHogTracing();
		return exported.map(span => span.name);
	}

	test('records steps of a user request and links them to the user', async () => {
		await traceUserRequest('user1', 'API: test', {}, () => withSpan('step', {}, async () => undefined));

		await flushPostHogTracing();
		expect(exported.map(span => span.name).sort()).toEqual(['API: test', 'step']);
		for (const span of exported) {
			expect(span.attributes).toContainEqual({ key: 'posthogDistinctId', value: { stringValue: 'user1' } });
		}
	});

	test('does not record work outside a user request', async () => {
		await withSpan('background', {}, async () => undefined);

		expect(await exportedNames()).toEqual([]);
	});

	test('does not record work detached from the request', async () => {
		await traceUserRequest('user1', 'API: test', {}, async () => {
			await runDetached(() => withSpan('detached', {}, async () => undefined));
		});

		expect(await exportedNames()).not.toContain('detached');
	});

	test('does not record requests by untraced users', async () => {
		await traceUserRequest('service', 'API: test', {}, () => withSpan('step', {}, async () => undefined));

		expect(await exportedNames()).toEqual([]);
	});

	test('stops recording new steps once the request has returned, even under a step that is still running', async () => {
		const { promise: released, resolve: release } = Promise.withResolvers<void>();
		let afterResponse!: Promise<void>;

		await traceUserRequest('user1', 'API: test', {}, async () => {
			afterResponse = withSpan('outlives request', {}, async () => {
				await released;
				await withSpan('after response', {}, async () => undefined);
			});
		});
		release();
		await afterResponse;

		const names = await exportedNames();
		expect(names).toContain('API: test');
		expect(names).not.toContain('after response');
	});

	test.each([
		'https://remote.example/api/check',
		'HTTPS://remote.example/api/check',
	])('does not export URL query strings from errors (%s)', async (url) => {
		await expect(traceUserRequest('user1', 'API: test', {}, async () => {
			throw new Error(`request error from ${url}?key=SECRET`);
		})).rejects.toThrow();

		await flushPostHogTracing();
		const [span] = exported;
		expect(span.status?.message).toBe(`request error from ${url}`);
		expect(JSON.stringify(span)).not.toContain('SECRET');
	});
});
