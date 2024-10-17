/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { URL } from 'url';
import { In } from 'typeorm';
import { generateImageUrl } from '@imgproxy/imgproxy-node';
import { DI } from '@/di-symbols.js';
import type { DriveFilesRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import type { Packed } from '@/misc/json-schema.js';
import { awaitAll } from '@/misc/prelude/await-all.js';
import type { MiUser } from '@/models/User.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import { appendQuery, query } from '@/misc/prelude/url.js';
import { deepClone } from '@/misc/clone.js';
import { bindThis } from '@/decorators.js';
import { isMimeImage } from '@/misc/is-mime-image.js';
import { IdService } from '@/core/IdService.js';
import { UtilityService } from '../UtilityService.js';
import { VideoProcessingService } from '../VideoProcessingService.js';
import { UserEntityService } from './UserEntityService.js';
import { DriveFolderEntityService } from './DriveFolderEntityService.js';

type PackOptions = {
	detail?: boolean,
	self?: boolean,
	withUser?: boolean,
};

@Injectable()
export class DriveFileEntityService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		// 循環参照のため / for circular dependency
		@Inject(forwardRef(() => UserEntityService))
		private userEntityService: UserEntityService,

		private utilityService: UtilityService,
		private driveFolderEntityService: DriveFolderEntityService,
		private videoProcessingService: VideoProcessingService,
		private idService: IdService,
	) {
	}

	@bindThis
	public validateFileName(name: string): boolean {
		return (
			(name.trim().length > 0) &&
			(name.length <= 200) &&
			(name.indexOf('\\') === -1) &&
			(name.indexOf('/') === -1) &&
			(name.indexOf('..') === -1)
		);
	}

	@bindThis
	public getPublicProperties(file: MiDriveFile): MiDriveFile['properties'] {
		if (file.properties.orientation != null) {
			const properties = deepClone(file.properties);
			if (file.properties.orientation >= 5) {
				[properties.width, properties.height] = [properties.height, properties.width];
			}
			properties.orientation = undefined;
			return properties;
		}

		return file.properties;
	}

	@bindThis
	private getProxiedUrl(url: string, mode?: 'static' | 'avatar', mimeType?: string): string {
		const defaultURL = appendQuery(
			`${this.config.mediaProxy}/${mode ?? 'image'}.webp`,
			query({
				url,
				...(mode ? { [mode]: '1' } : {}),
			}),
		);

		if (this.config.imgproxyURL) {
			// Check file type, imgproxy supports only images
			let supportedFiletype = false;

			// If mimeType is provided, use it to determine if the file is an image
			if (mimeType) {
				if (isMimeImage(mimeType, 'sharp-convertible-image') && mimeType !== 'image/gif') {
					supportedFiletype = true;
				}
			} else {
				// Parse URL and get extension
				const ext = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? '';
				if (['jpg', 'jpeg', 'png', 'webp', 'svg', 'bmp', 'tiff', 'webp'].includes(ext)) {
					supportedFiletype = true;
				}
			}

			let options = {};
			if (mode === 'avatar') {
				options = {
					width: 320,
					height: 320,
					gravity: {
						type: 'sm',
					},
					enlarge: true,
				};
			} else if (mode === 'static') {
				if (!supportedFiletype) {
					return defaultURL;
				}

				options = {
					width: 500,
					height: 0,
					gravity: {
						type: 'sm',
					},
					enlarge: true,
					auto_rotate: true,
				};
			} else {
				return defaultURL;
			}

			return generateImageUrl({
				endpoint: this.config.imgproxyURL,
				key: this.config.imgproxyKey,
				salt: this.config.imgproxySalt,
				url: url,
				options,
			});
		}

		return defaultURL;
	}

	@bindThis
	public getThumbnailUrl(file: MiDriveFile): string | null {
		// Prioritize returning an existing thumbnail URL if it's available
		if (file.thumbnailUrl) {
			return file.thumbnailUrl;
		}

		// Handle video files separately
		if (file.type.startsWith('video')) {
			return this.videoProcessingService.getExternalVideoThumbnailUrl(file.webpublicUrl ?? file.url);
		}

		// Handle remote linked files with expired keys through a local proxy if allowed by the configuration
		if (file.uri && file.isLink && this.config.proxyRemoteFiles) {
			return this.getProxiedUrl(file.uri, 'static', file.type);
		}

		// If none of the above conditions are met, we assume no valid thumbnail URL is available
		return null;
	}

	@bindThis
	public getPublicUrl(file: MiDriveFile, mode?: 'avatar'): string {
		// Handle the case where a specific avatar URL is requested
		if (mode === 'avatar') {
			const avatarUrl = file.webpublicUrl ?? file.url;
			return this.getProxiedUrl(avatarUrl, 'avatar', file.type);
		}

		// Handle the general case where no specific mode is required
		const isSafeCDNUrl = (url: string) => {
			try {
				const parsedUrl = new URL(url);
				const allowedHosts = ['s3.plasmatrap.com'];
				return allowedHosts.includes(parsedUrl.host);
			} catch (e) {
				return false;
			}
		};

		// Return the direct URL if it's secure and available
		if (file.url && isSafeCDNUrl(file.url)) {
			return file.url;
		} else if (file.url && !isSafeCDNUrl(file.url) && this.config.externalMediaProxyEnabled) {
			return this.getProxiedUrl(file.url, mode, file.type);
		}

		// Use external media proxy for remote files not linked directly
		if (file.uri && this.config.externalMediaProxyEnabled && file.isLink) {
			return this.getProxiedUrl(file.uri, mode, file.type);
		}

		// Attempt to use a local proxy for remote files that are links
		if (file.uri && file.isLink && this.config.proxyRemoteFiles) {
			const key = file.webpublicAccessKey;
			// Ensure the key does not contain '/' indicating it's not an old storage key
			if (key && !key.includes('/')) {
				const proxiedUrl = `${this.config.url}/files/${key}`;
				return proxiedUrl;
			}
		}

		// Fallback to the public URL if available
		return file.webpublicUrl ?? file.url;
	}

	@bindThis
	public async calcDriveUsageOf(user: MiUser['id'] | { id: MiUser['id'] }): Promise<number> {
		const id = typeof user === 'object' ? user.id : user;

		const { sum } = await this.driveFilesRepository
			.createQueryBuilder('file')
			.where('file.userId = :id', { id: id })
			.andWhere('file.isLink = FALSE')
			.select('SUM(file.size)', 'sum')
			.getRawOne();

		return parseInt(sum, 10) || 0;
	}

	@bindThis
	public async calcDriveUsageOfHost(host: string): Promise<number> {
		const { sum } = await this.driveFilesRepository
			.createQueryBuilder('file')
			.where('file.userHost = :host', { host: this.utilityService.toPuny(host) })
			.andWhere('file.isLink = FALSE')
			.select('SUM(file.size)', 'sum')
			.getRawOne();

		return parseInt(sum, 10) || 0;
	}

	@bindThis
	public async calcDriveUsageOfLocal(): Promise<number> {
		const { sum } = await this.driveFilesRepository
			.createQueryBuilder('file')
			.where('file.userHost IS NULL')
			.andWhere('file.isLink = FALSE')
			.select('SUM(file.size)', 'sum')
			.getRawOne();

		return parseInt(sum, 10) || 0;
	}

	@bindThis
	public async calcDriveUsageOfRemote(): Promise<number> {
		const { sum } = await this.driveFilesRepository
			.createQueryBuilder('file')
			.where('file.userHost IS NOT NULL')
			.andWhere('file.isLink = FALSE')
			.select('SUM(file.size)', 'sum')
			.getRawOne();

		return parseInt(sum, 10) || 0;
	}

	@bindThis
	public async pack(
		src: MiDriveFile['id'] | MiDriveFile,
		options?: PackOptions,
	): Promise<Packed<'DriveFile'>> {
		const opts = Object.assign({
			detail: false,
			self: false,
		}, options);

		const file = typeof src === 'object' ? src : await this.driveFilesRepository.findOneByOrFail({ id: src });

		return await awaitAll<Packed<'DriveFile'>>({
			id: file.id,
			createdAt: this.idService.parse(file.id).date.toISOString(),
			name: file.name,
			type: file.type,
			md5: file.md5,
			size: file.size,
			isSensitive: file.isSensitive,
			blurhash: file.blurhash,
			properties: opts.self ? file.properties : this.getPublicProperties(file),
			url: opts.self ? file.url : this.getPublicUrl(file),
			thumbnailUrl: this.getThumbnailUrl(file),
			comment: file.comment,
			folderId: file.folderId,
			folder: opts.detail && file.folderId ? this.driveFolderEntityService.pack(file.folderId, {
				detail: true,
			}) : null,
			userId: opts.withUser ? file.userId : null,
			user: (opts.withUser && file.userId) ? this.userEntityService.pack(file.userId) : null,
		});
	}

	@bindThis
	public async packNullable(
		src: MiDriveFile['id'] | MiDriveFile,
		options?: PackOptions,
		hint?: {
			packedUser?: Packed<'UserLite'>
		},
	): Promise<Packed<'DriveFile'> | null> {
		const opts = Object.assign({
			detail: false,
			self: false,
		}, options);

		const file = typeof src === 'object' ? src : await this.driveFilesRepository.findOneBy({ id: src });
		if (file == null) return null;

		return await awaitAll<Packed<'DriveFile'>>({
			id: file.id,
			createdAt: this.idService.parse(file.id).date.toISOString(),
			name: file.name,
			type: file.type,
			md5: file.md5,
			size: file.size,
			isSensitive: file.isSensitive,
			blurhash: file.blurhash,
			properties: opts.self ? file.properties : this.getPublicProperties(file),
			url: opts.self ? file.url : this.getPublicUrl(file),
			thumbnailUrl: this.getThumbnailUrl(file),
			comment: file.comment,
			folderId: file.folderId,
			folder: opts.detail && file.folderId ? this.driveFolderEntityService.pack(file.folderId, {
				detail: true,
			}) : null,
			userId: file.userId,
			user: (opts.withUser && file.userId) ? hint?.packedUser ?? this.userEntityService.pack(file.userId) : null,
		});
	}

	@bindThis
	public async packMany(
		files: MiDriveFile[],
		options?: PackOptions,
	): Promise<Packed<'DriveFile'>[]> {
		const _user = files.map(({ user, userId }) => user ?? userId).filter(x => x != null);
		const _userMap = await this.userEntityService.packMany(_user)
			.then(users => new Map(users.map(user => [user.id, user])));
		const items = await Promise.all(files.map(f => this.packNullable(f, options, f.userId ? { packedUser: _userMap.get(f.userId) } : {})));
		return items.filter(x => x != null);
	}

	@bindThis
	public async packManyByIdsMap(
		fileIds: MiDriveFile['id'][],
		options?: PackOptions,
	): Promise<Map<Packed<'DriveFile'>['id'], Packed<'DriveFile'> | null>> {
		if (fileIds.length === 0) return new Map();
		const files = await this.driveFilesRepository.findBy({ id: In(fileIds) });
		const packedFiles = await this.packMany(files, options);
		const map = new Map<Packed<'DriveFile'>['id'], Packed<'DriveFile'> | null>(packedFiles.map(f => [f.id, f]));
		for (const id of fileIds) {
			if (!map.has(id)) map.set(id, null);
		}
		return map;
	}

	@bindThis
	public async packManyByIds(
		fileIds: MiDriveFile['id'][],
		options?: PackOptions,
	): Promise<Packed<'DriveFile'>[]> {
		if (fileIds.length === 0) return [];
		const filesMap = await this.packManyByIdsMap(fileIds, options);
		return fileIds.map(id => filesMap.get(id)).filter(x => x != null);
	}
}
