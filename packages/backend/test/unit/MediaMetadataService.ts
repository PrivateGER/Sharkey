/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import * as fileType from 'file-type';
import sharp from 'sharp';
import { MediaMetadataService } from '@/core/MediaMetadataService.js';
import { VideoProcessingService } from '@/core/VideoProcessingService.js';
import type { ImageProcessingService } from '@/core/ImageProcessingService.js';
import type { LoggerService } from '@/core/LoggerService.js';
import type { Config } from '@/config.js';

const execFileAsync = promisify(execFile);

const exif = {
	IFD0: { Make: 'TestPhone', Model: 'GPSCam' },
	IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 41/1 22/1', GPSLongitudeRef: 'E', GPSLongitude: '139/1 41/1 30/1' },
};

async function readTags(path: string): Promise<Record<string, unknown>> {
	const { stdout } = await execFileAsync('exiftool', ['-j', '-n', '-G1', '-a', path]);
	return JSON.parse(stdout)[0];
}

async function probe(path: string): Promise<{ streams: { codec_type: string }[]; format: { tags?: Record<string, string> } }> {
	const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]);
	return JSON.parse(stdout);
}

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(body));
	return Buffer.concat([length, body, crc]);
}

describe('MediaMetadataService', () => {
	let dir: string;
	let service: MediaMetadataService;

	beforeAll(async () => {
		dir = await fs.mkdtemp(join(os.tmpdir(), 'media-metadata-'));
		const loggerService = {
			getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
		} as unknown as LoggerService;
		service = new MediaMetadataService(new VideoProcessingService({} as Config, {} as ImageProcessingService, loggerService));
	});

	afterAll(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	test('removes location and camera details from a JPEG, keeping orientation, colour profile and pixels', async () => {
		const path = join(dir, 'photo.jpg');
		const image = sharp({ create: { width: 64, height: 48, channels: 3, background: '#3a7' } });
		await fs.writeFile(path, await image.withExif(exif).withIccProfile('p3').jpeg({ quality: 90 }).toBuffer());
		await execFileAsync('exiftool', ['-q', '-overwrite_original', '-n', '-Orientation=6', path]);
		const pixelsBefore = await sharp(path).raw().toBuffer();

		await service.strip(path, 'image/jpeg');

		const tags = await readTags(path);
		const names = Object.keys(tags).map(k => k.split(':').pop()!);
		expect(names.filter(n => n.startsWith('GPS'))).toEqual([]);
		expect(names).not.toContain('Make');
		expect(names).not.toContain('Model');
		expect(tags['IFD0:Orientation']).toBe(6);
		expect(names).toContain('ProfileDescription');
		expect((await sharp(path).raw().toBuffer()).equals(pixelsBefore)).toBe(true);
	});

	test('removes text chunks and EXIF from a PNG', async () => {
		const path = join(dir, 'screenshot.png');
		const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#123' } }).withExif(exif).png().toBuffer();
		// tEXt goes right after IHDR, which ends at byte 33
		const comment = pngChunk('tEXt', Buffer.from('Comment\0home address: 123 Example St', 'latin1'));
		await fs.writeFile(path, Buffer.concat([png.subarray(0, 33), comment, png.subarray(33)]));

		await service.strip(path, 'image/png');

		const bytes = await fs.readFile(path);
		expect(bytes.includes('Example St')).toBe(false);
		expect(bytes.includes('GPSCam')).toBe(false);
		expect((await sharp(path).metadata()).width).toBe(32);
	});

	test('removes location and device tags from a phone-style MP4 and drops data tracks the MP4 muxer cannot write', async () => {
		const mov = join(dir, 'source.mov');
		await execFileAsync('ffmpeg', [
			'-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=10', '-t', '1', '-c:v', 'mpeg4',
			// tmcd: a data track the MP4 muxer cannot write
			'-timecode', '00:00:00:00',
			'-metadata', 'location=+35.6895+139.6917/', '-metadata', 'make=TestPhone', '-metadata', 'model=GPSCam',
			'-f', 'mov', mov,
		]);
		// Brand it as MP4, so the input is an MP4 holding a track MP4 cannot hold
		const path = join(dir, 'phone.mp4');
		const bytes = await fs.readFile(mov);
		bytes.write('mp42', 8, 'latin1');
		await fs.writeFile(path, bytes);
		const before = await probe(path);
		expect(before.format.tags?.location).toBeDefined();
		expect(before.streams.map(s => s.codec_type)).toEqual(['video', 'data']);

		await service.strip(path, 'video/mp4');

		const after = await probe(path);
		expect(after.format.tags?.location).toBeUndefined();
		expect(after.format.tags?.make).toBeUndefined();
		expect(after.format.tags?.model).toBeUndefined();
		expect(after.streams.map(s => s.codec_type)).toEqual(['video']);
		expect((await fs.readFile(path)).includes('139.6917')).toBe(false);
	});

	test.each([
		['Matroska', 'clip.mkv', ['-c:v', 'mpeg4', '-c:a', 'libopus', '-f', 'matroska']],
		['MPEG-1 program stream', 'clip1.mpg', ['-c:v', 'mpeg1video', '-c:a', 'mp2', '-f', 'mpeg']],
		['MPEG-2 program stream', 'clip2.mpg', ['-c:v', 'mpeg2video', '-c:a', 'mp2', '-f', 'vob']],
	])('strips %s videos under the MIME type file detection reports', async (_name, file, encodeArgs) => {
		const path = join(dir, file);
		await execFileAsync('ffmpeg', [
			'-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=25', '-f', 'lavfi', '-i', 'sine=d=1', '-t', '1',
			'-metadata', 'title=Somewhere private', ...encodeArgs, path,
		]);
		const detected = await fileType.fileTypeFromFile(path);

		await service.strip(path, detected!.mime);

		const after = await probe(path);
		expect(after.format.tags?.title).toBeUndefined();
		expect(after.streams.map(s => s.codec_type).sort()).toEqual(['audio', 'video']);
	});

	test('keeps the audio of an MP4 that holds only audio and cover art', async () => {
		const path = join(dir, 'song.mp4');
		await execFileAsync('ffmpeg', [
			'-v', 'error', '-f', 'lavfi', '-i', 'sine=d=1', '-f', 'lavfi', '-i', 'color=red:s=32x32:d=1',
			'-map', '0:a', '-map', '1:v', '-frames:v', '1', '-c:a', 'aac', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic',
			'-f', 'mp4', path,
		]);
		const detected = await fileType.fileTypeFromFile(path);
		expect(detected?.mime).toBe('video/mp4');

		await service.strip(path, detected!.mime);

		expect((await probe(path)).streams.map(s => s.codec_type)).toEqual(['audio']);
	});

	test('rejects images it cannot rewrite', async () => {
		const path = join(dir, 'broken.jpg');
		await fs.writeFile(path, Buffer.from('not actually a jpeg'));

		await expect(service.strip(path, 'image/jpeg')).rejects.toThrow();
	});

	test('rejects videos in containers it cannot remux', async () => {
		const path = join(dir, 'clip.unknown');
		await fs.writeFile(path, Buffer.from('opaque video data'));

		await expect(service.strip(path, 'video/x-unknown')).rejects.toThrow();
	});
});
