/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { MutingsRepository, MiMuting } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import type { MiUser } from '@/models/User.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { CacheService } from '@/core/CacheService.js';

@Injectable()
export class UserMutingService {
	constructor(
		@Inject(DI.mutingsRepository)
		private mutingsRepository: MutingsRepository,

		private idService: IdService,
		private cacheService: CacheService,
	) {
	}

	@bindThis
	public async tryMute(user: { id: string }, target: { id: string }, expiresAt: Date | null = null): Promise<boolean> {
		const hasExistingMute = await this.mutingsRepository.existsBy({
			muterId: user.id,
			muteeId: target.id,
		});
		if (hasExistingMute) {
			return false;
		}

		await this.mute(user, target, expiresAt);
		return true;
	}

	@bindThis
	public async mute(user: { id: string }, target: { id: string }, expiresAt: Date | null = null): Promise<void> {
		await this.mutingsRepository.insert({
			id: this.idService.gen(),
			expiresAt: expiresAt ?? null,
			muterId: user.id,
			muteeId: target.id,
		});

		await this.cacheService.userMutingsCache.delete(user.id);
	}

	@bindThis
	public async tryUnmute(user: { id: string }, target: { id: string }): Promise<boolean> {
		const mutes = await this.mutingsRepository.findBy({
			muterId: user.id,
			muteeId: target.id,
		});
		if (mutes.length < 1) {
			return false;
		}

		await this.unmute(mutes);
		return true;
	}

	@bindThis
	public async unmute(mutings: MiMuting[]): Promise<void> {
		if (mutings.length === 0) return;

		await this.mutingsRepository.delete({
			id: In(mutings.map(m => m.id)),
		});

		await this.cacheService.userMutingsCache.deleteMany(mutings.map(m => m.muterId));
	}
}
