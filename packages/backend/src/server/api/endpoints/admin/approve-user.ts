import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository } from '@/models/_.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { DI } from '@/di-symbols.js';
import { EmailService } from '@/core/EmailService.js';
import { CacheService } from '@/core/CacheService.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import { trackPromise } from '@/misc/promise-tracker.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:approve-user',
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
		@Inject(DI.usersRepository)
		private readonly usersRepository: UsersRepository,

		private readonly moderationLogService: ModerationLogService,
		private readonly emailService: EmailService,
		private readonly cacheService: CacheService,
		private readonly internalEventService: InternalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const [user, profile] = await Promise.all([
				this.cacheService.findLocalUserById(ps.userId),
				this.cacheService.userProfileCache.fetchMaybe(ps.userId),
			]);

			if (user.approved) return;

			if (user.isDeleted) {
				throw new Error('user not found or already deleted');
			}

			await this.usersRepository.update(user.id, {
				approved: true,
			});

			if (profile?.email) {
				trackPromise(this.emailService.sendEmail(profile.email, 'Account Approved',
					'Your Account has been approved have fun socializing!',
					'Your Account has been approved have fun socializing!'));
			}

			await Promise.all([
				this.internalEventService.emit('userUpdated', { id: user.id }),
				this.moderationLogService.log(me, 'approve', {
					userId: user.id,
					userUsername: user.username,
					userHost: user.host,
				}),
			]);
		});
	}
}
