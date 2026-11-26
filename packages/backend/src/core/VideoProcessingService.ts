/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import fs from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import FFmpeg from 'fluent-ffmpeg';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { ImageProcessingService } from '@/core/ImageProcessingService.js';
import type { IImage } from '@/core/ImageProcessingService.js';
import { createTemp, createTempDir } from '@/misc/create-temp.js';
import { bindThis } from '@/decorators.js';
import { appendQuery, query } from '@/misc/prelude/url.js';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';

// Keyed by the MIME types file-type reports: local uploads of any video type missing here are rejected.
const remuxFormats = new Map<string, { format: string; faststart: boolean }>([
	['video/mp4', { format: 'mp4', faststart: true }],
	['video/x-m4v', { format: 'mp4', faststart: true }],
	['video/quicktime', { format: 'mov', faststart: true }],
	['video/3gpp', { format: '3gp', faststart: true }],
	['video/3gpp2', { format: '3g2', faststart: true }],
	['video/webm', { format: 'webm', faststart: false }],
	['video/matroska', { format: 'matroska', faststart: false }],
	['video/mp2t', { format: 'mpegts', faststart: false }],
	['video/mpeg', { format: 'mpeg', faststart: false }],
	['video/MP1S', { format: 'mpeg', faststart: false }],
	['video/MP2P', { format: 'vob', faststart: false }],
	['video/ogg', { format: 'ogg', faststart: false }],
	['video/vnd.avi', { format: 'avi', faststart: false }],
	['video/x-flv', { format: 'flv', faststart: false }],
	['video/x-ms-asf', { format: 'asf', faststart: false }],
]);

@Injectable()
export class VideoProcessingService {
	private readonly logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private imageProcessingService: ImageProcessingService,

		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('video-processing');
	}

	@bindThis
	public async generateVideoThumbnail(source: string): Promise<IImage> {
		const [dir, cleanup] = await createTempDir();

		try {
			await new Promise((res, rej) => {
				FFmpeg({
					source,
				})
					.on('end', res)
					.on('error', rej)
					.screenshot({
						folder: dir,
						filename: 'out.png',	// must have .png extension
						count: 1,
						timestamps: ['5%'],
					});
			});

			return await this.imageProcessingService.convertToWebp(`${dir}/out.png`, 498, 422);
		} finally {
			cleanup();
		}
	}

	@bindThis
	public getVideoDuration(source: string): Promise<number | null> {
		return new Promise((resolve) => {
			FFmpeg.ffprobe(source, (err, metadata) => {
				if (err) {
					this.logger.warn(`ffprobe failed: ${err.message}`);
					resolve(null);
					return;
				}
				const dur = metadata.format.duration;
				resolve(dur != null && Number.isFinite(dur) && dur > 0 ? dur : null);
			});
		});
	}

	@bindThis
	public getExternalVideoThumbnailUrl(url: string): string | null {
		if (this.config.videoThumbnailGenerator == null) return null;

		return appendQuery(
			`${this.config.videoThumbnailGenerator}/thumbnail.webp`,
			query({
				thumbnail: '1',
				url,
			}),
		);
	}

	@bindThis
	public async remuxVideo(source: string, mimeType: string): Promise<boolean> {
		const remux = remuxFormats.get(mimeType);
		if (!remux) {
			this.logger.debug(`Skipping remux for unsupported MIME type: ${mimeType}`);
			return false;
		}

		const [tempPath, cleanup] = await createTemp();

		try {
			const options = [
				// Only video and audio: MP4 cannot hold some data tracks, so copying everything can fail.
				// Capital V skips attached pictures, which carry their own EXIF; optional because an
				// MP4 with only audio and cover art is still detected as video.
				'-map 0:V?',
				'-map 0:a?',
				'-c copy',
				'-map_metadata -1',
				'-map_chapters -1',
				'-fflags +bitexact',
			];
			if (remux.faststart) options.push('-movflags +faststart');

			const { promise, resolve, reject } = Promise.withResolvers<void>();
			FFmpeg(source)
				.format(remux.format)
				.addOutputOptions(options)
				.on('error', reject)
				.on('end', () => resolve())
				.save(tempPath);
			await promise;

			await fs.copyFile(tempPath, source);
			this.logger.info(`Remuxed video: ${source}`);
			return true;
		} finally {
			cleanup();
		}
	}
}

