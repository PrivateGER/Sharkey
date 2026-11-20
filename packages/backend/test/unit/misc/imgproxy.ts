/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from '@jest/globals';
import { signImgproxyPath } from '@/misc/imgproxy.js';

describe('misc:imgproxy', () => {
	// Worked example from https://docs.imgproxy.net/usage/signing_url
	test('signs paths the way imgproxy verifies them', () => {
		const path = '/rs:fill:300:400:0/g:sm/aHR0cDovL2V4YW1w/bGUuY29tL2ltYWdl/cy9jdXJpb3NpdHku/anBn.png';
		expect(signImgproxyPath(path, '736563726574', '68656C6C6F')).toBe('oKfUtW34Dvo2BGQehJFR4Nr0_rIjOtdtzJ3QFsUcXH8');
	});
});
