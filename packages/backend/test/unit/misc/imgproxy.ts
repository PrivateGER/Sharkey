/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from '@jest/globals';
import { buildImgproxyUrl, imgproxyVariantFromQuery, signImgproxyPath } from '@/misc/imgproxy.js';

const config = { url: 'https://imgproxy.example.com', key: '736563726574', salt: '68656C6C6F' };

/** Reads a generated URL the way imgproxy would, so the assertions don't depend on option spelling. */
function interpret(url: string) {
	expect(url.startsWith(`${config.url}/`)).toBe(true);
	const [signature, ...segments] = url.slice(config.url.length + 1).split('/');
	const path = `/${segments.join('/')}`;
	const [encodedSource, extension] = segments.pop()!.split('.');

	const result = {
		signatureValid: signature === signImgproxyPath(path, config.key, config.salt),
		source: Buffer.from(encodedSource, 'base64url').toString(),
		maxWidth: undefined as number | undefined,
		maxHeight: undefined as number | undefined,
		firstFrameOnly: false,
		format: extension ?? 'source',
		passthrough: [] as string[],
	};
	for (const [name, ...args] of segments.map(s => s.split(':'))) {
		switch (name) {
			case 'rs': case 'resize':
				expect(args[0]).toBe('fit');
				result.maxWidth = Number(args[1]);
				result.maxHeight = Number(args[2]);
				expect(args[3] ?? '0').toMatch(/^(0|f|false)$/); // never upscale
				break;
			case 'maf': case 'max_animation_frames':
				result.firstFrameOnly = args[0] === '1';
				break;
			case 'skp': case 'skip_processing':
				result.passthrough = args;
				break;
			case 'f': case 'format': case 'ext':
				result.format = args[0];
				break;
			default:
				throw new Error(`unexpected imgproxy option ${name}`);
		}
	}
	return result;
}

describe('misc:imgproxy', () => {
	// Worked example from https://docs.imgproxy.net/usage/signing_url
	test('signs paths the way imgproxy verifies them', () => {
		const path = '/rs:fill:300:400:0/g:sm/aHR0cDovL2V4YW1w/bGUuY29tL2ltYWdl/cy9jdXJpb3NpdHku/anBn.png';
		expect(signImgproxyPath(path, '736563726574', '68656C6C6F')).toBe('oKfUtW34Dvo2BGQehJFR4Nr0_rIjOtdtzJ3QFsUcXH8');
	});

	// Sizes and animation handling of the built-in /proxy handler in FileServerService; 0 = unconstrained.
	test.each([
		{ query: {}, expected: { maxWidth: undefined, maxHeight: undefined, firstFrameOnly: false, format: 'source' } },
		{ query: { emoji: '1' }, expected: { maxWidth: 0, maxHeight: 128, firstFrameOnly: false, format: 'webp' } },
		{ query: { emoji: '1', static: '1' }, expected: { maxWidth: 0, maxHeight: 128, firstFrameOnly: true, format: 'webp' } },
		{ query: { avatar: '1' }, expected: { maxWidth: 0, maxHeight: 320, firstFrameOnly: false, format: 'webp' } },
		{ query: { avatar: '1', static: '1' }, expected: { maxWidth: 0, maxHeight: 320, firstFrameOnly: true, format: 'webp' } },
		{ query: { emoji: '1', avatar: '1' }, expected: { maxWidth: 0, maxHeight: 128, firstFrameOnly: false, format: 'webp' } },
		{ query: { static: '1' }, expected: { maxWidth: 498, maxHeight: 422, firstFrameOnly: true, format: 'webp' } },
		{ query: { preview: '1' }, expected: { maxWidth: 200, maxHeight: 200, firstFrameOnly: true, format: 'webp' } },
		{ query: { fallback: '1' }, expected: { maxWidth: undefined, maxHeight: undefined, firstFrameOnly: false, format: 'source' } },
	])('$query is processed like the built-in proxy', ({ query, expected }) => {
		const source = 'https://remote.example/media/a b/ü.gif?size=large&v=2';
		const result = interpret(buildImgproxyUrl(config, source, imgproxyVariantFromQuery(query)));

		expect(result.signatureValid).toBe(true);
		expect(result.source).toBe(source);
		expect(result).toMatchObject(expected);
	});

	test('passes browser-safe originals through unprocessed', () => {
		const result = interpret(buildImgproxyUrl(config, 'https://remote.example/a.png', imgproxyVariantFromQuery({})));
		expect(result.passthrough).toEqual(expect.arrayContaining(['jpg', 'png', 'gif', 'webp', 'avif']));
	});
});
