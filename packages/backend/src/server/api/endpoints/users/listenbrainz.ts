/*
 * SPDX-FileCopyrightText: piuvas and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiMeta, UserProfilesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { ApiLoggerService } from '@/server/api/ApiLoggerService.js';
import { renderInlineError } from '@/misc/render-inline-error.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['users'],

	requireCredential: false, // thinking that having this be public may allow people to rate-limit our key.

	description: 'Fetch what the user is listening to.',

	res: {
		type: 'object',
		optional: true, nullable: false,
		properties: {
			title: { type: 'string', optional: false, nullable: false },
			artist: { type: 'string', optional: false, nullable: false },
			coverArt: { type: 'string', optional: true, nullable: false },
			listenbrainzUrl: { type: 'string', optional: true, nullable: false },
			musicbrainzUrl: { type: 'string', optional: true, nullable: false },
		},
	},

	errors: {
		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '10bbd034-29a9-4d14-8cdc-c34c14396154',
		},
		noListenbrainz: {
			message: 'The user does not have a listenbrainz url.',
			code: 'NO_LISTENBRAINZ',
			id: '93b56660-3c52-4d47-9d5a-d57b0dd38f0a',
		},
		listenbrainzError: {
			message: 'Error while fetching ListenBrainz data. Contact an instance administrator.',
			code: 'LISTENBRAINZ_ERROR',
			id: '42d2d282-0acd-432c-9431-d1504291e3fb',
		},
	},

	limit: {
		duration: 1000,
		max: 5,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private httpRequestService: HttpRequestService,
		private readonly loggerService: ApiLoggerService,
	) {
		super(meta, paramDef, async (ps) => {
			type ResponseType = {
				title: string,
				artist: string,
				coverArt: string | undefined,
				listenbrainzUrl: string | undefined,
				musicbrainzUrl: string | undefined,
			};

			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: ps.userId }).catch(() => {
				throw new ApiError(meta.errors.noSuchUser);
			});

			const listenbrainzUsername = profile.listenbrainz;
			if (!listenbrainzUsername) {
				throw new ApiError(meta.errors.noListenbrainz);
			}
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			if (this.serverSettings.listenbrainzAuthKey) {
				headers['Authorization'] = `Token ${this.serverSettings.listenbrainzAuthKey}`;
			}

			const res = await this.httpRequestService.send(`https://api.listenbrainz.org/1/user/${listenbrainzUsername}/playing-now`, {
				method: 'GET',
				headers,
				timeout: 10000,
			}).catch((err) => {
				this.loggerService.logger.error(`/playing-now error: ${renderInlineError(err)}`);
				throw new ApiError(meta.errors.listenbrainzError);
			});

			// /1/user/{user}/playing-now returns an array, but it only has a single item even if you are listening from multiple
			// devices. this happens because the return type is shared between all listenbrainz fetches.

			const json = (await res.json()) as {
				payload: {
					listens: Array<{
						track_metadata: {
							artist_name: string,
							track_name: string,
							release_name: string,
							additional_info: {
								release_mbid: string | undefined,
								recording_mbid: string | undefined,
							},
						},
					}>
				}
			};

			if (json.payload.listens.length === 0) { return undefined; }
			const playingNow = json.payload.listens[0];

			const response: ResponseType = {
				title: playingNow.track_metadata.track_name,
				artist: playingNow.track_metadata.artist_name,
				coverArt: undefined,
				listenbrainzUrl: undefined,
				musicbrainzUrl: undefined,
			};

			// also, additional_info MAY contain release_mbid and/or recording_mbid, which are more accurate than the lookup data.

			if (playingNow.track_metadata.additional_info.release_mbid) {
				response.coverArt =
					`https://coverartarchive.org/release/${playingNow.track_metadata.additional_info.release_mbid}/front-250`;
			}

			if (playingNow.track_metadata.additional_info.recording_mbid) {
				response.musicbrainzUrl =
					`https://musicbrainz.org/recording/${playingNow.track_metadata.additional_info.recording_mbid}`;
				response.listenbrainzUrl =
					`https://listenbrainz.org/player?recording_mbids=${playingNow.track_metadata.additional_info.recording_mbid}`;
			}

			if ((!response.coverArt || !response.musicbrainzUrl || !response.listenbrainzUrl) && this.serverSettings.listenbrainzAuthKey) {
				const res = await this.httpRequestService.send(
					`https://api.listenbrainz.org/1/metadata/lookup/?artist_name=${playingNow.track_metadata.artist_name}&recording_name=${playingNow.track_metadata.track_name}`,
					{
						method: 'GET',
						headers,
						timeout: 10000,
					}
				).catch((err) => {
					this.loggerService.logger.error(`/metadata/lookup error: ${renderInlineError(err)}`);
					throw new ApiError(meta.errors.listenbrainzError);
				});

				const json = (await res.json()) as {
					release_mbid: string | undefined,
					recording_mbid: string | undefined,
				};

				response.coverArt ??= `https://coverartarchive.org/release/${json.release_mbid}/front-250`;
				response.listenbrainzUrl ??= `https://listenbrainz.org/player?recording_mbids=${json.recording_mbid}`;
				response.musicbrainzUrl ??= `https://musicbrainz.org/recording/${json.recording_mbid}`;
			}
			return response;
		});
	}
}
