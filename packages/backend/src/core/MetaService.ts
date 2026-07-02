/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { InstancesRepository, MetasRepository } from '@/models/_.js';
import type { MiMeta } from '@/models/Meta.js';
import type { MiInstance } from '@/models/Instance.js';
import type { MiLocalUser } from '@/models/User.js';
import { diffArrays } from '@/misc/diff-arrays.js';
import { bindThis } from '@/decorators.js';
import { FeaturedService } from '@/core/FeaturedService.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

@Injectable()
export class MetaService {
	constructor(
		@Inject(DI.metasRepository)
		private readonly metasRepository: MetasRepository,

		@Inject(DI.instancesRepository)
		private readonly instancesRepository: InstancesRepository,

		@Inject(DI.meta)
		private readonly meta: MiMeta,

		private readonly featuredService: FeaturedService,
		private readonly internalEventService: InternalEventService,
		private readonly moderationLogService: ModerationLogService,
	) {}

	@bindThis
	public async update(updates: Partial<MiMeta>, opts?: {
		moderator?: MiLocalUser | null,
	}): Promise<MiMeta> {
		// Skip no-op changes
		if (Object.keys(updates).length < 1 || Object.values(updates).every((v: unknown) => v === undefined)) {
			return this.meta;
		}

		// Create before/after *copies*, without persisting anything
		const before = Object.assign({}, this.meta);
		const after = Object.assign({}, this.meta, updates);

		// Save to postgres
		await this.metasRepository.update({ id: this.meta.id }, updates);

		// Propagate changes to blockedHosts, silencedHosts, mediaSilencedHosts, federationInstances, and bubbleInstances to the relevant instance rows.
		await this.persistBlocks(before, after);

		// Propagate changes to hiddenTags
		await this.persistTags(before, after);

		// Update local singleton
		const updated = Object.assign(this.meta, updates);

		await Promise.all([
			// Propagate changes across the cluster
			// (do this last to make sure listeners get the results of persistBlocks / persistTags)
			this.internalEventService.emit('metaUpdated', { before, after }),

			// Record changes to ModLogs
			opts?.moderator != null && this.moderationLogService.log(opts.moderator, 'updateServerSettings', {
				before: sanitize(before),
				after: sanitize(after),
			}),
		]);

		return updated;
	}

	@bindThis
	private async persistBlocks(before: Partial<MiMeta>, after: Partial<MiMeta>): Promise<void> {
		await this.persistBlock(before.blockedHosts, after.blockedHosts, 'isBlocked');
		await this.persistBlock(before.silencedHosts, after.silencedHosts, 'isSilenced');
		await this.persistBlock(before.mediaSilencedHosts, after.mediaSilencedHosts, 'isMediaSilenced');
		await this.persistBlock(before.federationHosts, after.federationHosts, 'isAllowListed');
		await this.persistBlock(before.bubbleInstances, after.bubbleInstances, 'isBubbled');
	}

	@bindThis
	private async persistBlock(before: string[] | undefined, after: string[] | undefined, field: keyof MiInstance): Promise<void> {
		const { added, removed } = diffArrays(before, after);

		if (removed.length > 0) {
			await this.updateInstancesByHost(field, false, removed);
		}

		if (added.length > 0) {
			await this.updateInstancesByHost(field, true, added);
		}
	}

	@bindThis
	private async updateInstancesByHost(field: keyof MiInstance, value: boolean, hosts: string[]): Promise<void> {
		const patterns = hosts.map(host => genHostPattern(host));

		// Use non-array queries when possible, as they are indexed and can be much faster.
		if (patterns.length === 1) {
			await this.instancesRepository
				.createQueryBuilder('instance')
				.update()
				.set({ [field]: value })
				.where('(lower(reverse("host")) || \'.\') LIKE :pattern', { pattern: patterns[0] })
				.execute();
		} else if (patterns.length > 1) {
			await this.instancesRepository
				.createQueryBuilder('instance')
				.update()
				.set({ [field]: value })
				.where('(lower(reverse("host")) || \'.\') LIKE ANY (:patterns)', { patterns })
				.execute();
		}
	}

	@bindThis
	private async persistTags(before: Partial<MiMeta>, after: Partial<MiMeta>): Promise<void> {
		const { added } = diffArrays(before.hiddenTags, after.hiddenTags);
		await this.featuredService.removeHashtagsFromRanking(added);
	}
}

function genHostPattern(host: string): string {
	return host.toLowerCase().split('').reverse().join('') + '.%';
}

function sanitize<T extends MiMeta>(meta: T): T {
	return {
		...meta,
		hcaptchaSecretKey: '<redacted>',
		mcaptchaSecretKey: '<redacted>',
		recaptchaSecretKey: '<redacted>',
		turnstileSecretKey: '<redacted>',
		fcSecretKey: '<redacted>',
		smtpPass: '<redacted>',
		swPrivateKey: '<redacted>',
		objectStorageAccessKey: '<redacted>',
		objectStorageSecretKey: '<redacted>',
		deeplAuthKey: '<redacted>',
		libreTranslateKey: '<redacted>',
		listenbrainzAuthKey: '<redacted>',
		verifymailAuthKey: '<redacted>',
		truemailAuthKey: '<redacted>',
	};
}
