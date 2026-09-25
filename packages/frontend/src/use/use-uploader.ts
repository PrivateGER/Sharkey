/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { readAndCompressImage } from '@misskey-dev/browser-image-resizer';
import isAnimated from 'is-file-animated';
import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import { computed, defineAsyncComponent, markRaw, onUnmounted, ref, triggerRef } from 'vue';
import type { MenuItem } from '@/types/menu.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { isWebpSupported } from '@/utility/upload/isWebpSupported.js';
import { uploadFile, UploadAbortedError } from '@/utility/drive.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';

export type UploaderFeatures = {
	imageEditing?: boolean;
};

export type CompressionLevel = 0 | 1 | 2 | 3;

const THUMBNAIL_SUPPORTED_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/svg+xml',
	'image/gif',
];

const IMAGE_EDITING_SUPPORTED_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
];

const VIDEO_COMPRESSION_SUPPORTED_TYPES = [
	'video/mp4',
	'video/quicktime',
	'video/x-matroska',
];

// Compression that saves less than this is not worth the quality loss, so the original is kept instead
const MIN_COMPRESSION_SAVING = 0.05;

function isCompressionBeneficial(compressedSize: number, originalSize: number): boolean {
	return compressedSize <= originalSize * (1 - MIN_COMPRESSION_SAVING);
}

// Files below these sizes are not compressed by default: the gain is small and re-encoding takes time and costs quality
const MIN_DEFAULT_IMAGE_COMPRESSION_SIZE = 1024 * 1024; // 1MB
const MIN_DEFAULT_VIDEO_COMPRESSION_SIZE = 10 * 1024 * 1024; // 10MB

// Video compression is relative to the source, so that already compact videos are not blown up
// and users don't get surprised by a much worse video
const VIDEO_COMPRESSION_SETTINGS = {
	1: { maxShortSide: null, bitrateRatio: 0.8 },
	2: { maxShortSide: 1080, bitrateRatio: 0.6 },
	3: { maxShortSide: 720, bitrateRatio: 0.4 },
} as const satisfies Record<Exclude<CompressionLevel, 0>, { maxShortSide: number | null; bitrateRatio: number }>;

// Lowest bitrate we allow, in bits per pixel per frame. Below this, browser H.264 encoders produce visibly broken video.
const VIDEO_MIN_BITS_PER_PIXEL = 0.05;

const mimeTypeMap = {
	'image/webp': 'webp',
	'image/jpeg': 'jpg',
	'image/png': 'png',
} as const;

export type UploaderItem = {
	id: string;
	name: string;
	suffix: string;
	progress: { max: number; value: number } | null;
	thumbnail: string | null;
	preprocessing: boolean;
	preprocessProgress: number | null;
	uploading: boolean;
	uploaded: Misskey.entities.DriveFile | null;
	uploadFailed: boolean;
	aborted: boolean;
	compressionLevel: CompressionLevel;
	compressedSize?: number | null;
	/**
	 * Why the original is uploaded although compression would apply:
	 * the file is small enough to skip default compression, or compressing would not make it noticeably smaller.
	 */
	compressionSkipped?: 'small' | 'notBeneficial' | null;
	/** The alt text editor for this item is open */
	editingCaption?: boolean;
	preprocessedFile?: Blob | null;
	file: File;
	objectUrl: string;
	isSensitive?: boolean;
	caption?: string | null;
	abort?: (() => void) | null;
	abortPreprocess?: (() => void) | null;
};

export function getUploadName(item: UploaderItem): string {
	return item.name + (item.name.endsWith(item.suffix) ? '' : item.suffix);
}

function getCompressionSettings(level: CompressionLevel) {
	if (level === 1) {
		return {
			maxWidth: 2000,
			maxHeight: 2000,
		};
	} else if (level === 2) {
		return {
			maxWidth: 2000 * 0.75, // =1500
			maxHeight: 2000 * 0.75, // =1500
		};
	} else if (level === 3) {
		return {
			maxWidth: 2000 * 0.75 * 0.75, // =1125
			maxHeight: 2000 * 0.75 * 0.75, // =1125
		};
	} else {
		return null;
	}
}

function getCompressionLevelLabel(level: CompressionLevel): string {
	switch (level) {
		case 1: return i18n.ts.low;
		case 2: return i18n.ts.medium;
		case 3: return i18n.ts.high;
		default: return i18n.ts.none;
	}
}

export function useUploader(options: {
	folderId?: string | null;
	multiple?: boolean;
	features?: UploaderFeatures;
	/** Overrides the default compression level from the preferences */
	compressionLevel?: CompressionLevel;
	/** Returns the initial name of a file; falls back to the keepOriginalFilename preference */
	nameConverter?: (file: File) => string | undefined;
} = {}) {
	const events = new EventEmitter<{
		'itemUploaded': (ctx: { item: UploaderItem; }) => void;
	}>();

	const uploaderFeatures = computed<Required<UploaderFeatures>>(() => {
		return {
			imageEditing: options.features?.imageEditing ?? true,
		};
	});

	const items = ref<UploaderItem[]>([]);

	function getDefaultCompressionLevel(file: File): CompressionLevel {
		if (IMAGE_EDITING_SUPPORTED_TYPES.includes(file.type)) return options.compressionLevel ?? prefer.s.defaultImageCompressionLevel;
		if (VIDEO_COMPRESSION_SUPPORTED_TYPES.includes(file.type)) return options.compressionLevel ?? prefer.s.defaultVideoCompressionLevel;
		return 0;
	}

	function isTooSmallForDefaultCompression(file: File): boolean {
		if (IMAGE_EDITING_SUPPORTED_TYPES.includes(file.type)) return file.size < MIN_DEFAULT_IMAGE_COMPRESSION_SIZE;
		if (VIDEO_COMPRESSION_SUPPORTED_TYPES.includes(file.type)) return file.size < MIN_DEFAULT_VIDEO_COMPRESSION_SIZE;
		return false;
	}

	function initializeFile(file: File) {
		const id = uuid();
		const filename = file.name ?? 'untitled';
		const extension = filename.split('.').length > 1 ? '.' + filename.split('.').pop() : '';
		const objectUrl = window.URL.createObjectURL(file);
		const defaultCompressionLevel = getDefaultCompressionLevel(file);
		// An explicitly requested level (options.compressionLevel) always applies
		const skipAsSmall = defaultCompressionLevel !== 0 && options.compressionLevel == null && isTooSmallForDefaultCompression(file);
		items.value.push({
			id,
			name: options.nameConverter?.(file) ?? (prefer.s.keepOriginalFilename ? filename : id + extension),
			suffix: '',
			progress: null,
			thumbnail: THUMBNAIL_SUPPORTED_TYPES.includes(file.type) ? objectUrl : null,
			preprocessing: false,
			preprocessProgress: null,
			uploading: false,
			aborted: false,
			uploaded: null,
			uploadFailed: false,
			compressionLevel: skipAsSmall ? 0 : defaultCompressionLevel,
			compressionSkipped: skipAsSmall ? 'small' : null,
			file: markRaw(file),
			objectUrl,
		});
		const reactiveItem = items.value.at(-1)!;
		preprocess(reactiveItem).then(() => {
			triggerRef(items);
		});
	}

	function addFiles(newFiles: File[]) {
		for (const file of newFiles) {
			initializeFile(file);
		}
	}

	function revokeItemObjectUrls(item: UploaderItem) {
		if (item.thumbnail != null) URL.revokeObjectURL(item.thumbnail);
		URL.revokeObjectURL(item.objectUrl);
	}

	function createItemObjectUrl(item: UploaderItem, file: Blob | File): string {
		revokeItemObjectUrls(item);
		return window.URL.createObjectURL(file);
	}

	function updateItemObjectUrls(item: UploaderItem, file: Blob | File) {
		const newObjectUrl = createItemObjectUrl(item, file);
		item.objectUrl = newObjectUrl;
		item.thumbnail = THUMBNAIL_SUPPORTED_TYPES.includes(file.type) ? newObjectUrl : null;
	}

	function removeItem(item: UploaderItem) {
		revokeItemObjectUrls(item);
		items.value.splice(items.value.indexOf(item), 1);
	}

	function getMenu(item: UploaderItem): MenuItem[] {
		const menu: MenuItem[] = [];

		if (
			!item.preprocessing &&
			!item.uploading &&
			!item.uploaded
		) {
			menu.push({
				icon: 'ti ti-forms',
				text: i18n.ts.rename,
				action: async () => {
					const { result, canceled } = await os.inputText({
						type: 'text',
						title: i18n.ts.rename,
						placeholder: item.name,
						default: item.name,
					});
					if (canceled || result == null) return;
					if (result.trim() === '') return;

					item.name = result;
				},
			}, {
				type: 'switch',
				text: i18n.ts.sensitive,
				icon: 'ti ti-eye-exclamation',
				ref: computed({
					get: () => item.isSensitive ?? false,
					set: (value) => item.isSensitive = value,
				}),
			}, {
				type: 'divider',
			});
		}

		if (
			uploaderFeatures.value.imageEditing &&
			IMAGE_EDITING_SUPPORTED_TYPES.includes(item.file.type) &&
			!item.preprocessing &&
			!item.uploading &&
			!item.uploaded
		) {
			menu.push({
				icon: 'ti ti-crop',
				text: i18n.ts.cropImage,
				action: async () => {
					const cropped = await os.cropImageFile(item.file, { aspectRatio: null });
					const newObjectUrl = createItemObjectUrl(item, cropped);
					items.value.splice(items.value.indexOf(item), 1, {
						...item,
						file: markRaw(cropped),
						thumbnail: THUMBNAIL_SUPPORTED_TYPES.includes(cropped.type) ? newObjectUrl : null,
						objectUrl: newObjectUrl,
					});
					const reactiveItem = items.value.find(x => x.id === item.id)!;
					preprocess(reactiveItem).then(() => {
						triggerRef(items);
					});
				},
			});
		}

		if (
			(IMAGE_EDITING_SUPPORTED_TYPES.includes(item.file.type) || VIDEO_COMPRESSION_SUPPORTED_TYPES.includes(item.file.type)) &&
			!item.preprocessing &&
			!item.uploading &&
			!item.uploaded
		) {
			function changeCompressionLevel(level: CompressionLevel) {
				item.compressionLevel = level;
				item.compressionSkipped = null;
				preprocess(item).then(() => {
					triggerRef(items);
				});
			}

			const levels: CompressionLevel[] = [1, 2, 3];

			menu.push({
				icon: 'ti ti-leaf',
				text: `${i18n.ts.compress}: ${getCompressionLevelLabel(item.compressionLevel)}`,
				type: 'parent',
				children: [{
					type: 'radioOption',
					text: i18n.ts.none,
					active: computed(() => item.compressionLevel === 0),
					action: () => changeCompressionLevel(0),
				}, {
					type: 'divider',
				}, ...levels.map(level => ({
					type: 'radioOption' as const,
					text: getCompressionLevelLabel(level),
					active: computed(() => item.compressionLevel === level),
					action: () => changeCompressionLevel(level),
				}))],
			});
		}

		if (!item.preprocessing && !item.uploading && !item.uploaded) {
			menu.push({
				type: 'divider',
			}, {
				icon: 'ti ti-upload',
				text: i18n.ts.upload,
				action: () => {
					uploadOne(item);
				},
			}, {
				icon: 'ti ti-x',
				text: i18n.ts.remove,
				danger: true,
				action: () => {
					removeItem(item);
				},
			});
		} else if (item.preprocessing && item.abortPreprocess != null) {
			menu.push({
				type: 'divider',
			}, {
				icon: 'ti ti-player-stop',
				text: i18n.ts.abort,
				danger: true,
				action: () => {
					if (item.abortPreprocess != null) {
						item.abortPreprocess();
					}
				},
			});
		} else if (item.uploading) {
			menu.push({
				type: 'divider',
			}, {
				icon: 'ti ti-cloud-pause',
				text: i18n.ts.abort,
				danger: true,
				action: () => {
					if (item.abort != null) {
						item.abort();
					}
				},
			});
		}

		return menu;
	}

	async function uploadOne(item: UploaderItem): Promise<void> {
		item.uploadFailed = false;
		item.uploading = true;

		const { filePromise, abort } = uploadFile(item.preprocessedFile ?? item.file, {
			name: getUploadName(item),
			folderId: options.folderId === undefined ? prefer.s.uploadFolder : options.folderId,
			isSensitive: item.isSensitive ?? false,
			caption: item.caption ?? null,
			onProgress: (progress) => {
				if (item.progress == null) {
					item.progress = { max: progress.total, value: progress.loaded };
				} else {
					item.progress.value = progress.loaded;
					item.progress.max = progress.total;
				}
			},
		});

		item.abort = () => {
			item.abort = null;
			abort();
			item.uploading = false;
			item.uploadFailed = true;
		};

		await filePromise.then((file) => {
			item.uploaded = file;
			item.abort = null;
			events.emit('itemUploaded', { item });
		}).catch(err => {
			item.uploadFailed = true;
			item.progress = null;
			if (!(err instanceof UploadAbortedError)) {
				throw err;
			}
		}).finally(() => {
			item.uploading = false;
		});
	}

	async function upload() { // エラーハンドリングなどを考慮してシーケンシャルにやる
		items.value = items.value.map(item => ({
			...item,
			aborted: false,
			uploadFailed: false,
			uploading: false,
		}));

		for (const item of items.value.filter(item => item.uploaded == null)) {
			// アップロード処理途中で値が変わる場合（途中で全キャンセルされたりなど）もあるので、Array filterではなくここでチェック
			if (item.aborted) {
				continue;
			}

			// Keep going after a failed item: the error has already been shown and the item stays marked as failed
			await uploadOne(item).catch(err => {
				console.error('Failed to upload file', err);
			});
		}
	}

	function abortAll() {
		for (const item of items.value) {
			if (item.uploaded != null) {
				continue;
			}

			if (item.abortPreprocess != null) {
				item.abortPreprocess();
			}
			if (item.abort != null) {
				item.abort();
			}
			item.aborted = true;
			item.uploadFailed = true;
		}
	}

	async function preprocess(item: UploaderItem): Promise<void> {
		item.preprocessing = true;
		item.preprocessProgress = null;
		// Keep the "small file" note until the user picks a level themselves
		if (item.compressionLevel !== 0) item.compressionSkipped = null;

		if (IMAGE_EDITING_SUPPORTED_TYPES.includes(item.file.type)) {
			try {
				await preprocessForImage(item);
			} catch (err) {
				console.error('Failed to preprocess image', err);
			}
		}

		if (VIDEO_COMPRESSION_SUPPORTED_TYPES.includes(item.file.type)) {
			try {
				await preprocessForVideo(item);
			} catch (err) {
				console.error('Failed to preprocess video', err);
			}
		}

		item.preprocessing = false;
		item.preprocessProgress = null;
	}

	async function preprocessForImage(item: UploaderItem): Promise<void> {
		let preprocessedFile: Blob | File = item.file;

		const compressionSettings = getCompressionSettings(item.compressionLevel);
		const needsCompress = item.compressionLevel !== 0 && compressionSettings && !(await isAnimated(preprocessedFile));

		if (needsCompress) {
			const config = {
				mimeType: (isWebpSupported() ? 'image/webp' : 'image/jpeg') as 'image/webp' | 'image/jpeg',
				maxWidth: compressionSettings.maxWidth,
				maxHeight: compressionSettings.maxHeight,
				quality: isWebpSupported() ? 0.85 : 0.8,
			};

			try {
				const result = await readAndCompressImage(preprocessedFile, config);
				// The compression may not always reduce the file size
				if (isCompressionBeneficial(result.size, preprocessedFile.size)) {
					preprocessedFile = result;
					item.compressedSize = result.size;
					item.suffix = '.' + mimeTypeMap[config.mimeType];
				} else {
					item.compressedSize = null;
					item.compressionSkipped = 'notBeneficial';
					item.suffix = '';
				}
			} catch (err) {
				console.error('Failed to resize image', err);
			}
		} else {
			item.compressedSize = null;
			item.suffix = '';
		}

		updateItemObjectUrls(item, preprocessedFile);
		item.preprocessedFile = markRaw(preprocessedFile);
	}

	async function preprocessForVideo(item: UploaderItem): Promise<void> {
		let preprocessedFile: Blob | File = item.file;
		item.compressedSize = null;
		item.suffix = '';

		const settings = item.compressionLevel !== 0 ? VIDEO_COMPRESSION_SETTINGS[item.compressionLevel] : null;
		if (settings != null) {
			const mediabunny = await import('mediabunny');

			const input = new mediabunny.Input({
				source: new mediabunny.BlobSource(preprocessedFile),
				formats: mediabunny.ALL_FORMATS,
			});

			const videoTrack = await input.getPrimaryVideoTrack();
			const stats = videoTrack != null ? await videoTrack.computePacketStats() : null;

			if (videoTrack == null || stats == null || stats.averageBitrate <= 0) {
				item.compressionSkipped = 'notBeneficial';
			} else {
				const width = videoTrack.displayWidth;
				const height = videoTrack.displayHeight;
				const shortSide = Math.min(width, height);
				const scale = settings.maxShortSide != null && shortSide > settings.maxShortSide ? settings.maxShortSide / shortSide : 1;
				const outputPixels = width * height * scale * scale;
				const frameRate = stats.averagePacketRate > 0 ? stats.averagePacketRate : 30;

				// Fewer pixels need fewer bits, but not proportionally fewer
				const targetBitrate = Math.round(Math.max(
					stats.averageBitrate * settings.bitrateRatio * Math.pow(scale * scale, 0.75),
					outputPixels * frameRate * VIDEO_MIN_BITS_PER_PIXEL,
				));

				// Don't spend time encoding when the target would not save anything worthwhile
				if (!isCompressionBeneficial(targetBitrate, stats.averageBitrate)) {
					item.compressionSkipped = 'notBeneficial';
				} else {
					const output = new mediabunny.Output({
						target: new mediabunny.BufferTarget(),
						format: new mediabunny.Mp4OutputFormat(),
					});

					const currentConversion = await mediabunny.Conversion.init({
						input,
						output,
						video: {
							// Scale the short side; the other side follows the aspect ratio
							...(scale < 1 ? (width <= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) }) : {}),
							quality: new mediabunny.Quality({ bitrate: targetBitrate }),
						},
						audio: {
							// Explicitly keep audio (don't discard) and copy it if possible
							// without re-encoding to avoid WebCodecs limitations on iOS Safari
							discard: false,
						},
					});

					// The browser may be unable to decode or encode a track; never upload a video with a missing track
					if (!currentConversion.isValid || currentConversion.discardedTracks.length > 0) {
						item.compressionSkipped = 'notBeneficial';
					} else {
						currentConversion.onProgress = newProgress => item.preprocessProgress = newProgress;

						item.abortPreprocess = () => {
							item.abortPreprocess = null;
							currentConversion.cancel();
							item.preprocessing = false;
							item.preprocessProgress = null;
						};

						await currentConversion.execute();

						item.abortPreprocess = null;

						const compressedSize = output.target.buffer!.byteLength;
						// Encoders don't always hit the target, so check the result as well
						if (isCompressionBeneficial(compressedSize, preprocessedFile.size)) {
							preprocessedFile = new Blob([output.target.buffer!], { type: output.format.mimeType });
							item.compressedSize = compressedSize;
							item.suffix = '.mp4';
						} else {
							item.compressionSkipped = 'notBeneficial';
						}
					}
				}
			}
		}

		updateItemObjectUrls(item, preprocessedFile);
		item.preprocessedFile = markRaw(preprocessedFile);
	}

	async function ensureUploaded(item: UploaderItem): Promise<Misskey.entities.DriveFile> {
		if (item.uploaded == null) await uploadOne(item);
		if (item.uploaded == null) throw new Error('Failed to upload file');
		return item.uploaded;
	}

	function editCaption(item: UploaderItem) {
		if (item.preprocessing || item.uploading || item.editingCaption) return;

		item.editingCaption = true;
		let saving: Promise<void> = Promise.resolve();

		const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkFileCaptionEditWindow.vue')), {
			file: item.uploaded,
			default: item.uploaded?.comment ?? item.caption ?? null,
			mimeType: (item.preprocessedFile ?? item.file).type,
			previewUrl: item.thumbnail,
			// Alt text generation needs the file in the drive, so upload it first
			prepareFile: () => ensureUploaded(item),
		}, {
			done: caption => {
				const comment = caption.trim().length === 0 ? null : caption;
				item.caption = comment;
				if (item.uploaded != null) {
					saving = misskeyApi('drive/files/update', { fileId: item.uploaded.id, comment }).then(file => {
						item.uploaded = file;
					}).catch(err => {
						console.error('Failed to save alt text', err);
						os.alert({ type: 'error', text: i18n.ts.somethingHappened });
					});
				}
			},
			closed: () => {
				// Keep the dialog open until the alt text of an uploaded file has been saved
				saving.finally(() => {
					item.editingCaption = false;
				});
				dispose();
			},
		});
	}

	function reset() {
		for (const item of items.value) {
			revokeItemObjectUrls(item);
		}

		abortAll();
		items.value = [];
	}

	function dispose() {
		reset();
	}

	onUnmounted(() => {
		dispose();
	});

	return {
		items,
		addFiles,
		removeItem,
		abortAll,
		reset,
		dispose,
		upload,
		getMenu,
		editCaption,
		uploading: computed(() => items.value.some(item => item.uploading)),
		readyForUpload: computed(() => items.value.length > 0 && items.value.some(item => item.uploaded == null) && !items.value.some(item => item.uploading || item.preprocessing)),
		allItemsUploaded: computed(() => items.value.every(item => item.uploaded != null)),
		events,
	};
}
