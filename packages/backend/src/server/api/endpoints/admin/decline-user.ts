import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsedUsernamesRepository } from '@/models/_.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { DI } from '@/di-symbols.js';
import { EmailService } from '@/core/EmailService.js';
import { DeleteAccountService } from '@/core/DeleteAccountService.js';
import { CacheService } from '@/core/CacheService.js';
import { trackPromise } from '@/misc/promise-tracker.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:decline-user',
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
		@Inject(DI.usedUsernamesRepository)
		private usedUsernamesRepository: UsedUsernamesRepository,

		private moderationLogService: ModerationLogService,
		private emailService: EmailService,
		private deleteAccountService: DeleteAccountService,
		private readonly cacheService: CacheService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const [user, profile] = await Promise.all([
				this.cacheService.findLocalUserById(ps.userId),
				this.cacheService.userProfileCache.fetchMaybe(ps.userId),
			]);

			if (user.isDeleted) return;

			if (user.approved) {
				throw new Error('user is already approved');
			}

			if (profile?.email) {
				trackPromise(this.emailService.sendEmail(profile.email, 'Account Declined',
					'Your Account has been declined!',
					'Your Account has been declined!'));
			}

			await Promise.all([
				this.usedUsernamesRepository.delete({ username: user.username.toLowerCase() }),
				this.deleteAccountService.deleteAccount(user),
				this.moderationLogService.log(me, 'decline', {
					userId: user.id,
					userUsername: user.username,
					userHost: user.host,
				}),
			]);
		});
	}
}
