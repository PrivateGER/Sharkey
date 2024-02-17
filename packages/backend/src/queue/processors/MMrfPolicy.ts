import { IActivity, IObject } from '@/core/activitypub/type.js';
import Logger from '@/logger.js';

// TypeORM models
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import type { UsersRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { ApDbResolverService } from '@/core/activitypub/ApDbResolverService.js';
import { UserFollowingService } from '@/core/UserFollowingService.js';

export enum MMrfAction {
	Neutral,
	RejectNote,
	RewriteNote,
}

export type MMrfResponse = {
	action: MMrfAction;
	data: IActivity;
}

export async function runMMrf(activity: IActivity, logger: Logger, idService: IdService, apDbResolverService: ApDbResolverService): Promise<MMrfResponse> {
	if (activity.type !== 'Create') {
		return {
			action: MMrfAction.Neutral,
			data: activity,
		};
	}

	let mmrfActivity = activity;

	const keywordFilter = keywordFilterPolicy(activity, logger);
	if (keywordFilter.action === MMrfAction.RejectNote) {
		return keywordFilter;
	}

	const hellthreadFilter = hellthreadPolicy(activity, logger);
	if (hellthreadFilter.action === MMrfAction.RewriteNote) {
		mmrfActivity = hellthreadFilter.data;
	}

	const disarmMentions = await disarmNewMentions(mmrfActivity, logger, idService, apDbResolverService);
	if (disarmMentions.action === MMrfAction.RewriteNote) {
		mmrfActivity = disarmMentions.data;
	}

	return {
		action: MMrfAction.Neutral,
		data: mmrfActivity,
	};
}

// Filters based on keywords
function keywordFilterPolicy(activity: IActivity, logger: Logger) : MMrfResponse {
	const object: IObject = activity.object as IObject;
	if (object.content === undefined) {
		return {
			action: MMrfAction.Neutral,
			data: activity,
		};
	}

	const keywords = ['https://discord.gg/ctkpaarr', '@ap12@mastodon-japan.net'];

	if (keywords.some(keyword => object.content?.includes(keyword))) {
		logger.warn('Rejected note due to keyword filter, triggered by: ' + object.content);

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

// Removes mentions from notes if there are more than 5
function hellthreadPolicy(activity: IActivity, logger: Logger) : MMrfResponse {
	const object: IObject = activity.object as IObject;
	if (object.tag === undefined || !(object.tag instanceof Array)) {
		return {
			action: MMrfAction.Neutral,
			data: activity,
		};
	}

	const mentions = object.tag.filter(tag => tag.type === 'Mention');

	if (mentions.length >= 15) {
		logger.warn('Rewriting note due to hellthread, triggered by: ' + object.content);
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

async function disarmNewMentions(activity: IActivity, logger: Logger, idService: IdService, apDbResolverService: ApDbResolverService): Promise<MMrfResponse> {
	const object: IObject = activity.object as IObject;
	if (object.tag === undefined || !(object.tag instanceof Array)) {
		return {
			action: MMrfAction.Neutral,
			data: activity,
		};
	}

	// Check for user age
	const actor = activity.actor as IObject;
	if (actor.id === undefined) {
		return {
			action: MMrfAction.Neutral,
			data: activity,
		};
	}
	const user = await apDbResolverService.getUserFromApId(actor.id);
	if (user === null) {
		return {
			action: MMrfAction.Neutral,
			data: activity,
		};
	}

	// Check for user age
	const createdAt = idService.parse(user.id).date;
	const now = new Date();

	// If the user is less than a day old and not followed by anyone, rewrite to remove mentions
	if (now.getTime() - createdAt.getTime() < 86400000 && user.followersCount === 0) {
		logger.warn('Rewriting note due to user age, triggered by: ' + object.content);
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
