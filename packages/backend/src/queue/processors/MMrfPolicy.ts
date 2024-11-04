import { IActivity, IObject } from '@/core/activitypub/type.js';
import Logger from '@/logger.js';
import { IdService } from '@/core/IdService.js';
import { ApDbResolverService } from '@/core/activitypub/ApDbResolverService.js';
import { KeywordFilterPolicy } from '@/queue/processors/MMrfPolicies/KeywordFilterPolicy.js';
import { NewUserSpamPolicy } from '@/queue/processors/MMrfPolicies/NewUserSpamPolicy.js';
import { HellthreadPolicy } from '@/queue/processors/MMrfPolicies/HellthreadPolicy.js';

export enum MMrfAction {
	Neutral,
	RejectNote,
	RewriteNote,
}

export type MMrfResponse = {
	action: MMrfAction;
	data: IActivity;
}

export interface MMrfPolicy {
	runPolicy(activity: IActivity): Promise<MMrfResponse>;
}

async function applyPolicy(policy: any, activity: IActivity): Promise<MMrfResponse> {
	let response = await policy.runPolicy(activity);
	while (response.action === MMrfAction.RewriteNote) {
		activity = response.data;
		response = await policy.runPolicy(activity);
	}
	return response;
}

export async function runMMrf(activity: IActivity, logger: Logger, idService: IdService, apDbResolverService: ApDbResolverService): Promise<MMrfResponse> {
	if (activity.type !== 'Create') {
		return { action: MMrfAction.Neutral, data: activity };
	}

	const object: IObject = activity.object as IObject;
	if (object.type !== 'Note') {
		return { action: MMrfAction.Neutral, data: activity };
	}

	const policies = [
		new KeywordFilterPolicy(logger),
		new NewUserSpamPolicy(apDbResolverService, idService, logger),
		new HellthreadPolicy(logger)
	];

	let mmrfActivity = activity;

	for (const policy of policies) {
		const response = await applyPolicy(policy, mmrfActivity);
		if (response.action === MMrfAction.RejectNote) {
			return response;
		}
		mmrfActivity = response.data;
	}

	return { action: MMrfAction.Neutral, data: mmrfActivity };
}

