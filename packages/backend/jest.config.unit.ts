/*
* For a detailed explanation regarding each configuration property and type check, visit:
* https://jestjs.io/docs/en/configuration.html
*/

import base from './jest.config.common.ts';

export default {
	...base,
	setupFilesAfterEnv: [
		'<rootDir>/test/jest.setup.unit.ts',
	],
	testMatch: [
		'<rootDir>/test/unit/**/*.ts',
		'<rootDir>/src/**/*.test.ts',
	],
};
