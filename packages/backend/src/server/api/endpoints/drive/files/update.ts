/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DriveFilesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { RoleService } from '@/core/RoleService.js';
import { DriveService } from '@/core/DriveService.js';
import type { Config } from '@/config.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['drive'],

	requireCredential: true,

	kind: 'write:drive',

	description: 'Update the properties of a drive file.',

	errors: {
		invalidFileName: {
			message: 'Invalid file name.',
			code: 'INVALID_FILE_NAME',
			id: '395e7156-f9f0-475e-af89-53c3c23080c2',
		},

		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'e7778c7e-3af9-49cd-9690-6dbc3e6c972d',
		},

		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: '01a53b27-82fc-445b-a0c1-b558465a8ed2',
		},

		noSuchFolder: {
			message: 'No such folder.',
			code: 'NO_SUCH_FOLDER',
			id: 'ea8fb7a5-af77-4a08-b608-c0218176cd73',
		},

		restrictedByRole: {
			message: 'This feature is restricted by your role.',
			code: 'RESTRICTED_BY_ROLE',
			id: '7f59dccb-f465-75ab-5cf4-3ce44e3282f7',
		},

		commentTooLong: {
			message: 'Cannot upload the file because the comment exceeds the instance limit.',
			code: 'COMMENT_TOO_LONG',
			id: '333652d9-0826-40f5-a2c3-e2bedcbb9fe5',
		},
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'DriveFile',
	},

	// 100 calls per minute
	limit: {
		duration: 1000 * 60,
		max: 100,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		fileId: { type: 'string', format: 'misskey:id' },
		folderId: { type: 'string', format: 'misskey:id', nullable: true },
		name: { type: 'string' },
		isSensitive: { type: 'boolean' },
		comment: { type: 'string', nullable: true },
	},
	required: ['fileId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,
		@Inject(DI.config)
		private config: Config,

		private driveService: DriveService,
		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const file = await this.driveFilesRepository.findOneBy({ id: ps.fileId });
			if (file == null) {
				throw new ApiError(meta.errors.noSuchFile);
			}

			if (!await this.roleService.isModerator(me) && (file.userId !== me.id)) {
				throw new ApiError(meta.errors.accessDenied);
			}

			if (ps.comment && ps.comment.length > this.config.maxAltTextLength) {
				throw new ApiError(meta.errors.commentTooLong);
			}

			let packedFile;

			try {
				packedFile = await this.driveService.updateFile(file, {
					folderId: ps.folderId,
					name: ps.name,
					isSensitive: ps.isSensitive,
					comment: ps.comment,
				}, me);
			} catch (e) {
				if (e instanceof DriveService.InvalidFileNameError) {
					throw new ApiError(meta.errors.invalidFileName);
				} else if (e instanceof DriveService.NoSuchFolderError) {
					throw new ApiError(meta.errors.noSuchFolder);
				} else if (e instanceof DriveService.CannotUnmarkSensitiveError) {
					throw new ApiError(meta.errors.restrictedByRole);
				} else {
					throw e;
				}
			}

			return packedFile;
		});
	}
}
