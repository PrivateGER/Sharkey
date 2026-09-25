/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref } from 'vue';
import * as Misskey from 'misskey-js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useStream } from '@/stream.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import type { CompressionLevel, UploaderFeatures } from '@/use/use-uploader.js';

export function chooseFileFromPc(
	multiple: boolean,
	options?: {
		uploadFolder?: string | null;
		compressionLevel?: CompressionLevel;
		nameConverter?: (file: File) => string | undefined;
		features?: UploaderFeatures;
	},
): Promise<Misskey.entities.DriveFile[]> {
	return os.pickLocalFiles({ multiple }).then(files => {
		if (files.length === 0) return [];

		return os.launchUploader(files, {
			folderId: options?.uploadFolder ?? prefer.s.uploadFolder,
			multiple,
			features: options?.features,
			compressionLevel: options?.compressionLevel,
			nameConverter: options?.nameConverter,
		});
	});
}

export function chooseFileFromDrive(multiple: boolean): Promise<Misskey.entities.DriveFile[]> {
	return new Promise((res, rej) => {
		os.selectDriveFile(multiple).then(files => {
			res(files);
		});
	});
}

export function chooseFileFromUrl(options: { isForImport?: boolean } = {}): Promise<Misskey.entities.DriveFile> {
	return new Promise((res, rej) => {
		os.inputText({
			title: i18n.ts.uploadFromUrl,
			type: 'url',
			placeholder: i18n.ts.uploadFromUrlDescription,
		}).then(({ canceled, result: url }) => {
			if (canceled) return;

			const marker = Math.random().toString(); // TODO: UUIDとか使う

			const connection = useStream().useChannel('main');
			connection.on('urlUploadFinished', urlResponse => {
				if (urlResponse.marker === marker) {
					res(urlResponse.file);
					connection.dispose();
				}
			});

			misskeyApi('drive/files/upload-from-url', {
				url: url,
				folderId: prefer.s.uploadFolder,
				marker,
				isForImport: options.isForImport ?? false,
			});

			os.alert({
				title: i18n.ts.uploadFromUrlRequested,
				text: i18n.ts.uploadFromUrlMayTakeTime,
			});
		});
	});
}

function select(src: HTMLElement | EventTarget | null, label: string | null, multiple: boolean, options: { isForImport?: boolean } = {}): Promise<Misskey.entities.DriveFile[]> {
	return new Promise((res, rej) => {
		os.popupMenu([label ? {
			text: label,
			type: 'label',
		} : undefined, {
			text: i18n.ts.upload,
			icon: 'ti ti-upload',
			action: () => chooseFileFromPc(multiple).then(files => res(files)),
		}, {
			text: i18n.ts.fromDrive,
			icon: 'ti ti-cloud',
			action: () => chooseFileFromDrive(multiple).then(files => res(files)),
		}, {
			text: i18n.ts.fromUrl,
			icon: 'ti ti-link',
			action: () => chooseFileFromUrl({ isForImport: options.isForImport }).then(file => res([file])),
		}], src);
	});
}

export function selectFile(src: HTMLElement | EventTarget | null, label: string | null = null, options: { isForImport?: boolean } = {}): Promise<Misskey.entities.DriveFile> {
	return select(src, label, false, options).then(files => files[0]);
}

export function selectFiles(src: HTMLElement | EventTarget | null, label: string | null = null): Promise<Misskey.entities.DriveFile[]> {
	return select(src, label, true);
}
