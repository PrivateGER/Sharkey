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

		if (object.tag === undefined || !(object.tag instanceof Array) || object.inReplyTo != null || object.url === undefined) {
			return {
				action: MMrfAction.Neutral,
				data: activity,
			};
		}
		const mentionCount = object.tag.filter(tag => tag.type === 'Mention').length;
		// Single mentions are allowed for DM purposes / new accounts, spam typically uses more
		if (mentionCount <= 1) {
			return {
				action: MMrfAction.Neutral,
				data: activity,
			};
		}

		// Get user reference from AP Actor
		const actor = activity.actor as IObject;
		const user = await this.apDbResolverService.getUserFromApId(actor);
		if (user === null) {
			return {
				action: MMrfAction.Neutral,
				data: activity,
			};
		}

		// Disallow mentions out of the blue by accounts followed by no one
		if (user.followersCount === 0) {
			this.logger.warn('Rewriting note mentions, triggered by remote actor ' + user.uri + ' and note: ' + object.url);
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
