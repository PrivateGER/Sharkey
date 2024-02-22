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
		if (object.tag === undefined || !(object.tag instanceof Array) || object.inReplyTo != null) {
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

		// Check for user age
		const createdAt = this.idService.parse(user.id).date;
		const now = new Date();

		// If the user is less than 3 days old (exception: username = 10 characters) and not followed by min 3 people, rewrite to remove mentions
		if ((now.getTime() - createdAt.getTime() < (86400000 * 3) || user.username.length === 10) && user.followersCount < 3) {
			this.logger.warn('Rewriting note due to user age, triggered by remote actor ' + user.uri + ' and note: ' + object.url);
			object.tag = object.tag.filter(tag => tag.type !== 'Mention');
			activity.object = object;

			if (user.username.length === 10 && !user.username.includes(' ')) {
				this.logger.warn('Hard rejecting note due to user length matching spambots');

				return {
					action: MMrfAction.RejectNote,
					data: activity,
				};
			}

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
