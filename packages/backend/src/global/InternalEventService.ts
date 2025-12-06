/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { InternalEventTypes, EventUnionFromDictionary } from '@/core/GlobalEventService.js';
import type { JsonSerialized } from '@/misc/json-value.js';
import type { Config } from '@/config.js';
import type Redis from 'ioredis';

export type { InternalEventTypes } from '@/core/GlobalEventService.js';

export type EventValue<K extends keyof InternalEventTypes> = InternalEventTypes[K] | JsonSerialized<InternalEventTypes[K]>;

type InternalEventMessage = {
	node: string,
	channel: 'internal',
	message: EventUnionFromDictionary<InternalEventTypes>,
};

// This makes TypeScript shut up about casting Listener<T> to Listener<keyof InternalEventTypes>
export type AnyListener = (value: EventValue<keyof InternalEventTypes>, key: keyof InternalEventTypes, isLocal: boolean) => void | Promise<void>;
export type Listener<K extends keyof InternalEventTypes> = (value: EventValue<K>, key: K, isLocal: boolean) => void | Promise<void>;

export interface ListenerProps {
	ignoreLocal?: boolean,
	ignoreRemote?: boolean,
}

// Random 32-bit integer encoded as base-32
const thisNodeId = Math.round(Math.random() * Math.pow(2, 32)).toString(32);

@Injectable()
export class InternalEventService implements OnModuleInit, OnApplicationShutdown {
	private readonly listeners = new Map<keyof InternalEventTypes, Map<AnyListener, ListenerProps>>();

	constructor(
		@Inject(DI.redisForSub)
		private readonly redisForSub: Redis.Redis,

		@Inject(DI.redis)
		private readonly redisForPub: Redis.Redis,

		@Inject(DI.config)
		private readonly config: Pick<Config, 'host'>,
	) {}

	@bindThis
	public on<K extends keyof InternalEventTypes>(type: K, listener: Listener<K>, props?: ListenerProps): void {
		let set = this.listeners.get(type);
		if (!set) {
			set = new Map();
			this.listeners.set(type, set);
		}

		// Functionally, this is just a set with metadata on the values.
		set.set(listener as AnyListener, props ?? {});
	}

	@bindThis
	public off<K extends keyof InternalEventTypes>(type: K, listener: Listener<K>): void {
		this.listeners.get(type)?.delete(listener as AnyListener);
	}

	@bindThis
	public async emit<K extends keyof InternalEventTypes>(type: K, value: EventValue<K>): Promise<void> {
		await this.emitInternal(type, value, true);
		await this.redisForPub.publish(this.config.host, JSON.stringify({
			node: thisNodeId,
			channel: 'internal',
			message: { type: type, body: value },
		}));
	}

	@bindThis
	private async emitInternal<K extends keyof InternalEventTypes>(type: K, value: EventValue<K>, isLocal: boolean): Promise<void> {
		const listeners = this.listeners.get(type);
		if (!listeners) {
			return;
		}

		const promises: Promise<void>[] = [];
		for (const [listener, props] of listeners) {
			if ((isLocal && !props.ignoreLocal) || (!isLocal && !props.ignoreRemote)) {
				const promise = Promise.resolve(listener(value, type, isLocal));
				promises.push(promise);
			}
		}
		await Promise.all(promises);
	}

	@bindThis
	private async onMessage(_: string, data: string): Promise<void> {
		const obj = JSON.parse(data);

		if (obj.channel === 'internal' && obj.node !== thisNodeId) {
			const { type, body } = (obj as InternalEventMessage).message;
			await this.emitInternal(type, body, false);
		}
	}

	@bindThis
	public dispose(): void {
		this.redisForSub.off('message', this.onMessage);
		this.listeners.clear();
	}

	@bindThis
	public onApplicationShutdown(): void {
		this.dispose();
	}

	@bindThis
	public connect(): void {
		this.redisForSub.on('message', this.onMessage);
	}

	@bindThis
	public onModuleInit(): void {
		this.connect();
	}
}
