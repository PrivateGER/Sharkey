/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Don't use the shortened @/ import, as this file doesn't pass through SWC and therefore can't follow tsconfig paths.
// noinspection ES6PreferShortImport
import { prepEnv } from '../src/boot/prepEnv.js';

/**
 * Applies the Sharkey environment details into the test environment.
 * https://jestjs.io/docs/configuration#globalsetup-string
 */
export default async function setup() {
	// Make sure tests run in the Sharkey environment.
	await prepEnv();
}
