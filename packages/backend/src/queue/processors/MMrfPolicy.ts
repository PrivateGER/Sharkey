import {IActivity, IObject} from '@/core/activitypub/type.js';
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

export async function runMMrf(activity: IActivity, logger: Logger, idService: IdService, apDbResolverService: ApDbResolverService): Promise<MMrfResponse> {
	const keywordFilterPolicy = new KeywordFilterPolicy(logger);
	const newUserSpamPolicy = new NewUserSpamPolicy(apDbResolverService, idService, logger);
	const hellthreadPolicy = new HellthreadPolicy(logger);

	if (activity.type !== 'Create') {
		return {
			action: MMrfAction.Neutral,
			data: activity,
		};
	}
	const object: IObject = activity.object as IObject;

	if (object.type !== 'Note') {
		return {
			action: MMrfAction.Neutral,
			data: activity,
		};
	}

	let mmrfActivity = activity;
	const keywordFilterPolicyResponse = await keywordFilterPolicy.runPolicy(mmrfActivity);
	if (keywordFilterPolicyResponse.action === MMrfAction.RejectNote) {
		return keywordFilterPolicyResponse;
	} else if (keywordFilterPolicyResponse.action === MMrfAction.RewriteNote) {
		mmrfActivity = keywordFilterPolicyResponse.data;
	}

	const newUserSpamPolicyResponse = await newUserSpamPolicy.runPolicy(mmrfActivity);
	if (newUserSpamPolicyResponse.action === MMrfAction.RejectNote) {
		return newUserSpamPolicyResponse;
	} else if (newUserSpamPolicyResponse.action === MMrfAction.RewriteNote) {
		mmrfActivity = newUserSpamPolicyResponse.data;
	}

	const hellthreadPolicyResponse = await hellthreadPolicy.runPolicy(mmrfActivity);
	if (hellthreadPolicyResponse.action === MMrfAction.RewriteNote) {
		mmrfActivity = hellthreadPolicyResponse.data;
	}

	return {
		action: MMrfAction.Neutral,
		data: mmrfActivity,
	};
}

export interface MMrfPolicy {
	runPolicy(activity: IActivity): Promise<MMrfResponse>;
}
