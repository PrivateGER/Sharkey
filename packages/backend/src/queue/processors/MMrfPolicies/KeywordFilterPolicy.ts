import Logger from '@/logger.js';
import { IActivity, IObject } from '@/core/activitypub/type.js';
import { MMrfAction, MMrfPolicy, MMrfResponse } from '@/queue/processors/MMrfPolicy.js';

export class KeywordFilterPolicy implements MMrfPolicy {
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	async runPolicy(activity: IActivity): Promise<MMrfResponse> {
		const object: IObject = activity.object as IObject;
		if (object.content === undefined) {
			return {
				action: MMrfAction.Neutral,
				data: activity,
			};
		}

		const keywords = ['https://discord.gg/ctkpaarr', '@ap12@mastodon-japan.net', 'ctkpaarr'];

		if (keywords.some(keyword => object.content?.includes(keyword))) {
			this.logger.warn('Rejected note due to keyword filter, triggered by: ' + object.content);

			return {
				action: MMrfAction.RejectNote,
				data: activity,
			};
		}

		return {
			action: MMrfAction.Neutral,
			data: activity,
		};
	}
}
