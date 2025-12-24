/**
 * Hot-swaps tsconfig files to work around vite limitations.
 * Based on idea from https://github.com/vitejs/vite/discussions/8483#discussioncomment-6830634
 */

import nodeFs from 'node:fs';
import nodePath from 'node:path';
import { execa } from 'execa';

const [command, ...args] = process.argv.slice(2);
if (!command) {
	console.error('Aborting; no command provided');
}

const rootDir = nodePath.resolve(import.meta.dirname, '../');
const tsConfig = nodePath.resolve(rootDir, 'tsconfig.json');
const tsConfigBak = nodePath.resolve(rootDir, 'tsconfig.json.bak');
const tsConfigVue = nodePath.resolve(rootDir, 'tsconfig.vue.json');

let clean = true;

function cleanup() {
	if (!clean) {
		console.log('Restoring original tsconfig.json...');
		nodeFs.rmSync(tsConfig);
		nodeFs.renameSync(tsConfigBak, tsConfig);
	}
	clean = true;
}

['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM'].forEach(evt => {
	process.on(evt, () => {
		const exitCode = clean ? 0 : -1;
		try {
			cleanup();
		} catch (error) {
			console.error('Error in cleanup:', error);
		} finally {
			process.exit(exitCode);
		}
	});
});

try {
	console.log('Staging tsconfig.vue.json as tsconfig.json...');
	nodeFs.renameSync(tsConfig, tsConfigBak);
	nodeFs.copyFileSync(tsConfigVue, tsConfig);
	clean = false;

	console.log(`Starting ${command}...`);
	await execa(
		command,
		args,
		{
			stdout: process.stdout,
			stderr: process.stderr,
		},
	);

	cleanup();
} catch (error) {
	console.error(`Error running ${command}:`, error);
	throw error;
}
