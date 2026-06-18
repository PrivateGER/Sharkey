import { IActivity, IObject } from '@/core/activitypub/type.js';
import Logger from '@/logger.js';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { InstancesRepository, MrfPoliciesRepository, NotesRepository } from '@/models/_.js';
import { ApDbResolverService } from '@/core/activitypub/ApDbResolverService.js';
import { MrfLuaPolicyService } from '@/core/activitypub/mrf/MrfLuaPolicyService.js';
import type { MrfLuaPolicy } from '@/core/activitypub/mrf/MrfLuaPolicyService.js';
import { normalizeMrfPolicyScope } from '@/models/MrfPolicy.js';
import type { MrfPolicyScope } from '@/models/MrfPolicy.js';

export enum MMrfAction {
	Neutral,
	RejectNote,
	RewriteNote,
}

export type MMrfResponse = {
	action: MMrfAction;
	data: IActivity;
	reason?: string;
};

export type MMrfRuntimeContext = {
	actor: {
		uri: string;
		host: string | null;
		followersCount: number;
		followingCount: number;
	};
	localHost: string;
	signerHost: string;
	receivedAt: string;
};

type ScopedMrfLuaPolicy = MrfLuaPolicy & {
	scope: MrfPolicyScope;
};

@Injectable()
export class MMrfPolicyService {
	private mrfLuaPolicyService: MrfLuaPolicyService | null = null;

	constructor(
		@Inject(DI.mrfPoliciesRepository)
		private readonly mrfPoliciesRepository: MrfPoliciesRepository,

		@Inject(DI.instancesRepository)
		private readonly instancesRepository: InstancesRepository,

		@Inject(DI.notesRepository)
		private readonly notesRepository: NotesRepository,

		private readonly apDbResolverService: ApDbResolverService,
	) {
	}

	public async run(activity: IActivity, logger: Logger, context: MMrfRuntimeContext): Promise<MMrfResponse> {
		let mmrfActivity = activity;
		const policies = await this.getEnabledPolicies();
		this.mrfLuaPolicyService?.retainPreparedPolicyEngines(policies.map(policy => policy.id));
		let lookup: ReturnType<MMrfPolicyService['createLookupApi']> | undefined;

		for (const policy of policies) {
			if (!this.matchesPolicyScope(policy.scope, mmrfActivity)) {
				continue;
			}

			try {
				lookup ??= this.createLookupApi();
				const result = await this.getMrfLuaPolicyService().run(policy, {
					...context,
					activity: mmrfActivity,
				}, {
					lookup,
				});

				if (result.decision.action === 'reject') {
					logger.warn(`policy ${policy.id} rejected activity: ${result.decision.reason}`);
					return {
						action: MMrfAction.RejectNote,
						data: mmrfActivity,
						reason: `${policy.id}: ${result.decision.reason}`,
					};
				}

				if (result.decision.action === 'rewrite') {
					logger.info(`policy ${policy.id} rewrote activity: ${result.decision.reason ?? 'no reason provided'}`);
					mmrfActivity = result.decision.activity;
				}
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				logger.error(`policy ${policy.id} failed: ${reason}`);
				continue;
			}
		}

		return { action: MMrfAction.Neutral, data: mmrfActivity };
	}

	private matchesPolicyScope(scope: MrfPolicyScope, activity: IActivity): boolean {
		return this.matchesTypeSet(scope.activityTypes, this.getTypeSet(activity)) &&
			this.matchesTypeSet(scope.objectTypes, this.getObjectTypeSet(activity));
	}

	private matchesTypeSet(allowedTypes: string[] | null, actualTypes: string[]): boolean {
		if (allowedTypes === null) return true;
		return actualTypes.some(type => allowedTypes.includes(type));
	}

	private getTypeSet(object: IObject): string[] {
		if (typeof object.type === 'string') return [object.type];
		if (Array.isArray(object.type)) return object.type.filter(type => typeof type === 'string');
		return [];
	}

	private getObjectTypeSet(activity: IActivity): string[] {
		const object = Array.isArray(activity.object) ? activity.object[0] : activity.object;
		if (typeof object !== 'object' || object === null || Array.isArray(object)) return [];
		return this.getTypeSet(object);
	}

	private getMrfLuaPolicyService(): MrfLuaPolicyService {
		this.mrfLuaPolicyService ??= new MrfLuaPolicyService();
		return this.mrfLuaPolicyService;
	}

	private async getEnabledPolicies(): Promise<ScopedMrfLuaPolicy[]> {
		const policies = await this.mrfPoliciesRepository.find({
			where: {
				enabled: true,
			},
			order: {
				priority: 'ASC',
				id: 'ASC',
			},
		});

		return policies.map(policy => ({
			id: policy.id,
			name: policy.name,
			source: policy.source,
			timeoutMs: policy.timeoutMs,
			scope: normalizeMrfPolicyScope(policy.scope),
			paramsSchema: policy.paramsSchema,
			params: policy.params,
		}));
	}

	private createLookupApi() {
		const userCache = new Map<string, Promise<Record<string, unknown> | null>>();
		const instanceCache = new Map<string, Promise<Record<string, unknown> | null>>();
		const noteCache = new Map<string, Promise<Record<string, unknown> | null>>();

		const userByUri = async (uri: string): Promise<Record<string, unknown> | null> => {
			if (!userCache.has(uri)) {
				userCache.set(uri, this.apDbResolverService.getUserFromApId(uri)
					.then(user => user == null ? null : ({
						id: user.id,
						uri: user.uri,
						username: user.username,
						host: user.host,
						hasAvatar: user.avatarId != null || user.avatarUrl != null,
						hasBanner: user.bannerId != null || user.bannerUrl != null,
						followersCount: user.followersCount,
						followingCount: user.followingCount,
						updatedAt: user.updatedAt?.toISOString() ?? null,
						lastFetchedAt: user.lastFetchedAt?.toISOString() ?? null,
						isSuspended: user.isSuspended,
						isSilenced: user.isSilenced,
						isLocal: user.host == null,
					})));
			}

			return await userCache.get(uri)!;
		};

		return {
			userByUri,
			userByMention: async (mention: Record<string, unknown> | string): Promise<Record<string, unknown> | null> => {
				const uri = typeof mention === 'string' ? mention : mention.href;
				if (typeof uri !== 'string') return null;
				return await userByUri(uri);
			},
			instanceByHost: async (host: string): Promise<Record<string, unknown> | null> => {
				if (!instanceCache.has(host)) {
					instanceCache.set(host, this.instancesRepository.findOneBy({ host })
						.then(instance => instance == null ? null : ({
							host: instance.host,
							softwareName: instance.softwareName,
							softwareVersion: instance.softwareVersion,
							isBlocked: instance.isBlocked,
							isSilenced: instance.isSilenced,
							isMediaSilenced: instance.isMediaSilenced,
							isAllowListed: instance.isAllowListed,
							moderationNote: instance.moderationNote,
						})));
				}

				return await instanceCache.get(host)!;
			},
			noteByUri: async (uri: string): Promise<Record<string, unknown> | null> => {
				if (!noteCache.has(uri)) {
					noteCache.set(uri, this.notesRepository.findOne({
						where: [
							{ uri },
							{ url: uri },
						],
					}).then(note => note == null ? null : ({
						id: note.id,
						uri: note.uri,
						url: note.url,
						visibility: note.visibility,
						localOnly: note.localOnly,
						userId: note.userId,
						userHost: note.userHost,
						updatedAt: note.updatedAt?.toISOString() ?? null,
						isReply: note.replyId != null,
						isRenote: note.renoteId != null,
					})));
				}

				return await noteCache.get(uri)!;
			},
		};
	}
}
