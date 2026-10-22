/*
* For a detailed explanation regarding each configuration property and type check, visit:
* https://jestjs.io/docs/en/configuration.html
*/

import base from './jest.config.common.ts';

export default {
	...base,
	globalSetup: "<rootDir>/test/jest.setup.global.e2e.mjs",
	setupFilesAfterEnv: ["<rootDir>/test/jest.setup.e2e.mjs"],
	testMatch: [
		"<rootDir>/test/e2e/**/*.ts",
	],
};
