/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { createTempDir } from '@/misc/create-temp.js';
import { VideoProcessingService } from '@/core/VideoProcessingService.js';

const execFileAsync = promisify(execFile);

// Orientation and colour profile are copied back; without them photos would render rotated or with shifted colours.
const STRIP_ALL_ARGS = ['-all=', '--icc_profile:all', '-tagsfromfile', '@', '-Orientation'];

// Raw converters need Make/Model and the maker notes to render these, so only identifying tags are removed.
const STRIP_RAW_ARGS = [
	'-gps:all=', '-xmp:all=', '-iptc:all=', '-comment=',
	'-SerialNumber=', '-BodySerialNumber=', '-CameraSerialNumber=', '-InternalSerialNumber=', '-LensSerialNumber=',
	'-OwnerName=', '-ImageUniqueID=', '-RawDataUniqueID=',
];

// DNG renders from its standard tags alone, so its maker notes can go.
const STRIP_DNG_ARGS = [...STRIP_RAW_ARGS, '-makernotes:all='];

const EXIFTOOL_ARGS = new Map<string, string[]>([
	...[
		'image/jpeg', 'image/png', 'image/apng', 'image/gif', 'image/webp', 'image/avif',
		'image/heic', 'image/heic-sequence', 'image/heif', 'image/heif-sequence', 'image/jxl', 'image/jp2', 'image/jpx',
		'image/tiff', 'image/vnd.adobe.photoshop',
	].map(type => [type, STRIP_ALL_ARGS] as const),
	['image/x-adobe-dng', STRIP_DNG_ARGS],
	...[
		'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-sony-arw',
		'image/x-panasonic-rw2', 'image/x-olympus-orf', 'image/x-fujifilm-raf',
	].map(type => [type, STRIP_RAW_ARGS] as const),
]);

@Injectable()
export class MediaMetadataService {
	constructor(
		private readonly videoProcessingService: VideoProcessingService,
	) {
	}

	@bindThis
	public async strip(path: string, mime: string): Promise<void> {
		if (mime.startsWith('video/')) {
			if (!await this.videoProcessingService.remuxVideo(path, mime)) {
				throw new Error(`Cannot remove metadata from videos of type ${mime}`);
			}
			return;
		}

		const args = EXIFTOOL_ARGS.get(mime);
		if (args) await this.runExiftool(path, args);
	}

	private async runExiftool(path: string, args: string[]): Promise<void> {
		const [dir, cleanup] = await createTempDir();
		const output = join(dir, 'stripped');

		try {
			// -m: don't reject files over minor format warnings
			await execFileAsync('exiftool', ['-q', '-q', '-m', ...args, '-o', output, path], { timeout: 60_000 });
			await fs.copyFile(output, path);
		} finally {
			cleanup();
		}
	}
}
