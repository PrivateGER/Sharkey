/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, expect, test, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { cleanup, render } from '@testing-library/vue';
import type * as Misskey from 'misskey-js';
import { useUploader } from '@/use/use-uploader.js';

type EditorProps = { prepareFile: () => Promise<Misskey.entities.DriveFile> };

const mocks = vi.hoisted(() => ({
	uploadFile: vi.fn(),
	popup: vi.fn((_component: unknown, _props: EditorProps, _events?: unknown) => ({ dispose: vi.fn() })),
}));

vi.mock('@/utility/drive.js', () => ({
	uploadFile: mocks.uploadFile,
	UploadAbortedError: class extends Error {},
}));
vi.mock('@/os.js', () => ({ popup: mocks.popup, alert: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

// The uploader registers onUnmounted, so it has to be created during a component's setup
function inSetup<T>(build: () => T): T {
	let value: T | undefined;
	render(defineComponent({
		setup() {
			value = build();
			return () => null;
		},
	}));
	return value!;
}

test('generating alt text again while the file is still uploading reuses that upload', async () => {
	// Promise.withResolvers isn't in the frontend's TS lib yet
	let finishUpload: (file: Misskey.entities.DriveFile) => void = () => {};
	const pendingUpload = new Promise<Misskey.entities.DriveFile>(resolve => { finishUpload = resolve; });
	mocks.uploadFile.mockImplementation(() => ({ filePromise: pendingUpload, abort: vi.fn() }));

	const uploader = inSetup(() => useUploader());
	uploader.addFiles([new File(['hello'], 'notes.txt', { type: 'text/plain' })]);
	await vi.waitFor(() => expect(uploader.items.value[0].preprocessing).toBe(false));

	uploader.editCaption(uploader.items.value[0]);
	await nextTick();
	const { prepareFile } = mocks.popup.mock.calls[0][1];

	// The editor's first generation is cancelled mid-upload, then the user generates again
	const first = prepareFile();
	const second = prepareFile();

	finishUpload({ id: 'file1' } as Misskey.entities.DriveFile);

	await expect(first).resolves.toMatchObject({ id: 'file1' });
	await expect(second).resolves.toMatchObject({ id: 'file1' });
	expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
});

test('a failed upload can be retried from the alt text editor', async () => {
	mocks.uploadFile
		.mockImplementationOnce(() => ({ filePromise: Promise.reject(new Error('network')), abort: vi.fn() }))
		.mockImplementationOnce(() => ({ filePromise: Promise.resolve({ id: 'file1' }), abort: vi.fn() }));

	const uploader = inSetup(() => useUploader());
	uploader.addFiles([new File(['hello'], 'notes.txt', { type: 'text/plain' })]);
	await vi.waitFor(() => expect(uploader.items.value[0].preprocessing).toBe(false));

	uploader.editCaption(uploader.items.value[0]);
	await nextTick();
	const { prepareFile } = mocks.popup.mock.calls[0][1];

	await expect(prepareFile()).rejects.toThrow();
	await expect(prepareFile()).resolves.toMatchObject({ id: 'file1' });
});
