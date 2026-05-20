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
import OpenAI from 'openai';

export const meta = {
	tags: ['drive'],

	requireCredential: true,

	kind: 'write:drive',

	description: 'Generate alt text for a drive file.',

	errors: {
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

		generationFailed: {
			message: 'Failed to generate alt text.',
			code: 'GENERATION_FAILED',
			id: 'f9b3e8d2-1b7e-4e1c-8c5b-3e3e8a8d0d7b',
		},

		videoTooLong: {
			message: 'Video is too long (max 1 minute).',
			code: 'VIDEO_TOO_LONG',
			id: 'e30b9ece-76f8-44eb-a04c-d3b936037429',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			text: { type: 'string' },
		},
	},

	// 3 calls per minute
	limit: {
		duration: 1000 * 60,
		max: 3,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		fileId: { type: 'string', format: 'misskey:id' },
		modelType: { type: 'string', enum: ['fast', 'quality', 'experimental'], default: 'fast' },
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
	) {
		super(meta, paramDef, async (ps, me) => {
			const file = await this.driveFilesRepository.findOneBy({ id: ps.fileId });
			if (file == null) {
				throw new ApiError(meta.errors.noSuchFile);
			}

			if (file.userId !== me.id) {
				throw new ApiError(meta.errors.accessDenied);
			}

			const isImage = file.type.startsWith('image/');
			const isVideo = file.type.startsWith('video/');

			if (!isImage && !isVideo) {
				throw new ApiError(meta.errors.generationFailed);
			}

			if (isVideo) {
				const duration = file.properties.duration;
				if (duration == null || duration > 60) {
					throw new ApiError(meta.errors.videoTooLong);
				}
			}

			// Generate alt text
			const client = new OpenAI({
				baseURL: this.config.openai?.baseUrl,
				apiKey: this.config.openai?.apiKey,
				defaultHeaders: this.config.openai?.headers,
			});

			const modelType = isVideo ? 'fast' : ps.modelType;
			const selectedModel = this.config.openai?.models?.[modelType] ?? 'google/gemini-2.5-flash';

			const systemPrompt = isVideo
				? 'Generate concise, descriptive, and accessible alt text for the following video, which is a description for people who can\'t see it. Focus on describing the sequence of events, actions, movements, and any important visual or auditory elements. Mention any text shown on screen. Only return the alt text and ensure the description is concise.'
				: 'Generate concise, descriptive, and accessible alt text, which is a description for people who can\'t see the following image. Focus on clearly conveying the key visual elements, context, and emotions of the image while considering the intended audience. Type out any text contained. Only return the alt text and ensure the description is concise.';

			const mediaContent = isVideo
				? { type: 'video_url' as const, video_url: { url: file.url } }
				: { type: 'image_url' as const, image_url: { url: file.url } };

			const response = await client.chat.completions.create({
				model: selectedModel,
				messages: [
					{
						role: 'system',
						content: [
							{ type: 'text', text: systemPrompt },
						],
					},
					{
						role: 'user',
						// @ts-expect-error -- video_url content type is OpenRouter-specific, not in openai SDK types
						content: [mediaContent],
					},
				],
				stream: false,
				store: false,
			});

			if (response.choices.length === 0 || response.choices[0].message === undefined) {
				throw new ApiError(meta.errors.generationFailed);
			}

			return {
				text: response.choices[0].message.content ?? '',
			};
		});
	}
}
