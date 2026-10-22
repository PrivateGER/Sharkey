/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Jest's @swc/jest transform (jest.config.common.ts) compiles a .js globalSetup to CommonJS,
// so the test server's imports become require() calls and ESM-only workspace packages such as
// misskey-reversi fail to resolve (ERR_PACKAGE_PATH_NOT_EXPORTED). A .mjs file is not transformed
// and is loaded natively as ESM, so going through it keeps the whole import chain in ESM.
export { default } from '../built-test/entry.js';
