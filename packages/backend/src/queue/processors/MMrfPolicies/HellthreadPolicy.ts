import { MMrfAction, MMrfPolicy, MMrfResponse } from '@/queue/processors/MMrfPolicy.js';
import { IActivity, IObject } from '@/core/activitypub/type.js';
import Logger from '@/logger.js';

export class HellthreadPolicy implements MMrfPolicy {
	private logger: Logger;

	constructor(logger: Logger) {
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

		const mentions = object.tag.filter(tag => tag.type === 'Mention');

		if (mentions.length >= 15) {
			this.logger.warn('Rewriting note due to hellthread, triggered by: ' + object.content);
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
