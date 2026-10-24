/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeAll } from '@jest/globals';
// Don't use the shortened @/ import, as this file doesn't pass through SWC and therefore can't follow tsconfig paths.
// noinspection ES6PreferShortImport
import { prepEnv } from '../src/boot/prepEnv.js';

/**
 * Applies the Sharkey environment details into the test environment.
 * This file is loaded through setupFilesAfterEnv, which only evaluates the module, so the setup has to be
 * registered as a hook here instead of exported like a globalSetup function would be.
 * https://jestjs.io/docs/configuration#setupfilesafterenv-array
 */
beforeAll(async () => {
	// Make sure tests run in the Sharkey environment.
	await prepEnv();
});
