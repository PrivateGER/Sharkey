/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import FFmpeg from 'fluent-ffmpeg';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { ImageProcessingService } from '@/core/ImageProcessingService.js';
import type { IImage } from '@/core/ImageProcessingService.js';
import { createTempDir, createTemp } from '@/misc/create-temp.js';
import { bindThis } from '@/decorators.js';
import { appendQuery, query } from '@/misc/prelude/url.js';
import type Logger from "@/logger.js";
import {LoggerService} from "@/core/LoggerService.js";

@Injectable()
export class VideoProcessingService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private imageProcessingService: ImageProcessingService,

		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger("video-processing");
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

	/**
	 * Optimize video for web playback by adding faststart flag.
	 * This allows the video to start playing before it is fully downloaded.
	 * The original file is modified in-place.
	 * @param source Path to the video file
	 * @param mimeType The MIME type of the video
	 * @returns Promise that resolves when optimization is complete
	 */
	@bindThis
	public async webOptimizeVideo(source: string, mimeType: string): Promise<void> {
		const supportedMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

		if (!supportedMimeTypes.has(mimeType)) {
			this.logger.debug(`Skipping web optimization for unsupported MIME type: ${mimeType}`);
			return;
		}

		const [tempPath, cleanup] = await createTemp();

		try {
			await new Promise<void>((resolve, reject) => {
				FFmpeg(source)
					.addOutputOptions('-c copy') // Copy streams without re-encoding
					.addOutputOptions('-movflags +faststart')
					.on('error', reject)
					.on('end', () => resolve())
					.save(tempPath);
			});

			// Replace original file with optimized version
			const fs = await import('node:fs/promises');
			await fs.copyFile(tempPath, source);
			this.logger.debug(`Web-optimized video: ${source}`);
		} catch (error) {
			this.logger.warn(`Failed to web-optimize video: ${source}`, { error });
			throw error;
		} finally {
			cleanup();
		}
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
}

