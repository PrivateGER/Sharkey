import { MMrfAction, MMrfPolicy, MMrfResponse } from '@/queue/processors/MMrfPolicy.js';
import { IActivity, IObject } from '@/core/activitypub/type.js';
import { ApDbResolverService } from '@/core/activitypub/ApDbResolverService.js';
import { IdService } from '@/core/IdService.js';
import Logger from '@/logger.js';

export class NewUserSpamPolicy implements MMrfPolicy {
	private apDbResolverService: ApDbResolverService;
	private idService: IdService;
	private logger: Logger;

	constructor(apDbResolverService: ApDbResolverService, idService: IdService, logger: Logger) {
		this.apDbResolverService = apDbResolverService;
		this.idService = idService;
		this.logger = logger;
	}

	async runPolicy(activity: IActivity): Promise<MMrfResponse> {
		const object: IObject = activity.object as IObject;

		if (object.tag === undefined || !(object.tag instanceof Array)) {
			return {
				action: MMrfAction.Neutral,
				data: activity,
			};
		}
		const objectMentions = object.tag.filter(tag => tag.type === 'Mention');
		const mentionCount = objectMentions.length;

		// Verify that the mention contains at least one local user mention
		const localMention = objectMentions.some(tag => tag.href?.startsWith('https://plasmatrap.com'));
		if (!localMention) {
			return {
				action: MMrfAction.Neutral,
				data: activity,
			};
		}

		// Get user reference from AP Actor
		const actor = activity.actor as IObject;
		const user = await this.apDbResolverService.getUserFromApId(actor);
		if (user === null) {
			this.logger.warn('User not found for remote actor ' + actor.url);
			return {
				action: MMrfAction.Neutral,
				data: activity,
			};
		}

		// Disallow mentions out of the blue by accounts followed by no one and with no avatar
		if (user.followersCount === 0 && user.followingCount === 0 && object.inReplyTo === null) {
			this.logger.warn('Rewriting note mentions, triggered by remote actor ' + user.uri + ' and note: ' + object.id);
			object.tag = object.tag.filter(tag => tag.type !== 'Mention');
			activity.object = object;

			return {
				action: MMrfAction.RewriteNote,
				data: activity,
			};
		}

		return {
			action: MMrfAction.Neutral,
			data: activity,
		};
	}
}
