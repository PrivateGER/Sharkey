/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { URLSearchParams } from 'node:url';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { GetterService } from '@/server/api/GetterService.js';
import { RoleService } from '@/core/RoleService.js';
import type { MiMeta, MiNote } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { CacheService } from '@/core/CacheService.js';
import { hasText } from '@/models/Note.js';
import { ApiLoggerService } from '@/server/api/ApiLoggerService.js';
import { NoteVisibilityService } from '@/core/NoteVisibilityService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: 'optional',
	kind: 'read:account',
	requiredRolePolicy: 'canUseTranslator',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			sourceLang: { type: 'string', optional: true, nullable: false },
			text: { type: 'string', optional: true, nullable: false },
		},
	},

	errors: {
		unavailable: {
			message: 'Translate of notes unavailable.',
			code: 'UNAVAILABLE',
			id: '50a70314-2d8a-431b-b433-efa5cc56444c',
		},
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'bea9b03f-36e0-49c5-a4db-627a029f8971',
		},
		cannotTranslateInvisibleNote: {
			message: 'Cannot translate invisible note.',
			code: 'CANNOT_TRANSLATE_INVISIBLE_NOTE',
			id: 'ea29f2ca-c368-43b3-aaf1-5ac3e74bbe5d',
		},
		translationFailed: {
			message: 'Failed to translate note. Please try again later or contact an administrator for assistance.',
			code: 'TRANSLATION_FAILED',
			id: '4e7a1a4f-521c-4ba2-b10a-69e5e2987b2f',
		},
	},

	// 10 calls per 5 seconds
	limit: {
		duration: 1000 * 5,
		max: 10,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		targetLang: { type: 'string' },
	},
	required: ['noteId', 'targetLang'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		private noteEntityService: NoteEntityService,
		private getterService: GetterService,
		private httpRequestService: HttpRequestService,
		private roleService: RoleService,
		private readonly cacheService: CacheService,
		private readonly loggerService: ApiLoggerService,
		private readonly noteVisibilityService: NoteVisibilityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			const { accessible } = await this.noteVisibilityService.checkNoteVisibilityAsync(note, me);
			if (!accessible) {
				throw new ApiError(meta.errors.cannotTranslateInvisibleNote);
			}

			if (!hasText(note)) {
				return {};
			}

			const canDeeplFree = this.serverSettings.deeplFreeMode && !!this.serverSettings.deeplFreeInstance;
			const canDeepl = !!this.serverSettings.deeplAuthKey || canDeeplFree;
			const canLibre = !!this.serverSettings.libreTranslateURL;
			if (!canDeepl && !canLibre) throw new ApiError(meta.errors.unavailable);

			let targetLang = ps.targetLang;
			if (targetLang.includes('-')) targetLang = targetLang.split('-')[0];

			let response = await this.cacheService.getCachedTranslation(note, targetLang);
			if (!response) {
				this.loggerService.logger.debug(`Fetching new translation for note=${note.id} lang=${targetLang}`);
				response = await this.fetchTranslation(note, targetLang);
				if (!response) {
					throw new ApiError(meta.errors.translationFailed);
				}

				await this.cacheService.setCachedTranslation(note, targetLang, response);
			}
			return response;
		});
	}

	private async fetchTranslation(note: MiNote & { text: string }, targetLang: string) {
		// Load-bearing try/catch - removing this will shift indentation and cause ~80 lines of upstream merge conflicts
		try {
			// Ignore deeplFreeInstance unless deeplFreeMode is set
			const deeplFreeInstance = this.serverSettings.deeplFreeMode ? this.serverSettings.deeplFreeInstance : null;

			// DeepL/DeepLX handling
			if (this.serverSettings.deeplAuthKey || deeplFreeInstance) {
				const params = new URLSearchParams();
				if (this.serverSettings.deeplAuthKey) params.append('auth_key', this.serverSettings.deeplAuthKey);
				params.append('text', note.text);
				params.append('target_lang', targetLang);
				const endpoint = deeplFreeInstance ?? ( this.serverSettings.deeplIsPro ? 'https://api.deepl.com/v2/translate' : 'https://api-free.deepl.com/v2/translate' );

				const res = await this.httpRequestService.send(endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						Accept: 'application/json, */*',
					},
					body: params.toString(),
					timeout: this.serverSettings.translationTimeout,
				});
				if (this.serverSettings.deeplAuthKey) {
					const json = (await res.json()) as {
						translations: {
							detected_source_language: string;
							text: string;
						}[];
					};

					return {
						sourceLang: json.translations[0].detected_source_language,
						text: json.translations[0].text,
					};
				} else {
					const json = (await res.json()) as {
						code: number,
						message: string,
						data: string,
						source_lang: string,
						target_lang: string,
						alternatives: string[],
					};

					const languageNames = new Intl.DisplayNames(['en'], {
						type: 'language',
					});

					return {
						sourceLang: languageNames.of(json.source_lang),
						text: json.data,
					};
				}
			}

			// LibreTranslate handling
			if (this.serverSettings.libreTranslateURL) {
				const res = await this.httpRequestService.send(this.serverSettings.libreTranslateURL, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Accept: 'application/json, */*',
					},
					body: JSON.stringify({
						q: note.text,
						source: 'auto',
						target: targetLang,
						format: 'text',
						api_key: this.serverSettings.libreTranslateKey ?? '',
					}),
					timeout: this.serverSettings.translationTimeout,
				});

				const json = (await res.json()) as {
					alternatives: string[],
					detectedLanguage: { [key: string]: string | number },
					translatedText: string,
				};

				const languageNames = new Intl.DisplayNames(['en'], {
					type: 'language',
				});

				return {
					sourceLang: languageNames.of(json.detectedLanguage.language as string),
					text: json.translatedText,
				};
			}
		} catch (e) {
			this.loggerService.logger.error('Unhandled error from translation API: ', { e });
		}

		return null;
	}
}
