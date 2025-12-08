/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { InternalEventTypes as MkInternalEventTypes, EventUnionFromDictionary } from '@/core/GlobalEventService.js';
import type { JsonSerialized } from '@/misc/json-value.js';
import type { Config } from '@/config.js';
import { SkEventSource, type ListenerProps, type EventListener } from '@/misc/SkEventEmitter.js';
import { withCleanup } from '@/misc/promiseUtils.js';
import { bindThis } from '@/decorators.js';
import { DI } from '@/di-symbols.js';
import type Redis from 'ioredis';

/**
 * Internal Event types definition.
 * Key = event name (string)
 * Value = payload type (object)
 */
export type InternalEventTypes = {
	[K in keyof MkInternalEventTypes]: MkInternalEventTypes[K] | JsonSerialized<MkInternalEventTypes[K]>;
};

/**
 * Structured message sent between processes over Redis IPC.
 */
export type InternalEventMessage = {
	node: string;
	channel: 'internal';
	message: EventUnionFromDictionary<InternalEventTypes>;
};

/**
 * Optional properties to customize event listener behavior.
 */
export interface InternalEventProps extends ListenerProps {
	ignoreLocal?: boolean;
	ignoreRemote?: boolean;
}

/**
 * Additional context passed between emit() calls; used to implement InternalEventProps filtering.
 */
export interface InternalEventContext {
	isLocal: boolean;
}

/**
 * Unique identifier used to detect and ignore our own messages sent through Redis IPC.
 * Implemented as a random 32-bit integer encoded as base-32, which provides a good balance of uniqueness vs memory space.
 */
const thisNodeId = Math.round(Math.random() * Math.pow(2, 32)).toString(32);

@Injectable()
export class InternalEventService extends SkEventSource<InternalEventTypes, InternalEventProps, InternalEventContext> implements OnModuleInit, OnApplicationShutdown {
	// private readonly listeners = new Map<keyof InternalEventTypes, Map<AnyListener, InternalEventProps>>();

	constructor(
		@Inject(DI.redis)
		private readonly redisForPub: Redis.Redis,

		@Inject(DI.redisForSub)
		private readonly redisForSub: Redis.Redis,

		@Inject(DI.config)
		private readonly config: Pick<Config, 'host'>,
	) {
		super();
	}

	@bindThis
	public override async emit<K extends keyof InternalEventTypes>(type: K, value: InternalEventTypes[K], context?: InternalEventContext): Promise<void> {
		await withCleanup(
			// Call local listeners first
			async () => await this.emitLocally(type, value, context),

			// Sync remote processes last, even if a local listener threw an exception
			async () => await this.emitExternally(type, value),
		);
	}

	protected async emitLocally<K extends keyof InternalEventTypes>(type: K, value: InternalEventTypes[K], context?: InternalEventContext): Promise<void> {
		await super.emit(type, value, context);
	}

	protected async emitExternally<K extends keyof InternalEventTypes>(type: K, value: InternalEventTypes[K]): Promise<void> {
		const message: InternalEventMessage = {
			node: thisNodeId,
			channel: 'internal',
			message: { type: type, body: value } as EventUnionFromDictionary<InternalEventTypes>,
		};
		await this.redisForPub.publish(this.config.host, JSON.stringify(message));
	}

	protected filterListener<K extends keyof InternalEventTypes>(type: K, value: InternalEventTypes[K], registration: [EventListener<InternalEventTypes, K>, Partial<InternalEventProps>], context: Partial<InternalEventContext>): boolean {
		// isLocal is always populated for remote events.
		const isLocal = context.isLocal ?? true;

		// Filter for local/remote events
		if (isLocal) {
			if (registration[1].ignoreLocal) return false;
		} else {
			if (registration[1].ignoreRemote) return false;
		}

		return true;
	}

	@bindThis
	private async onMessage(_: string, data: string): Promise<void> {
		const obj = JSON.parse(data);

		if (isInternalEventMessage(obj) && obj.node !== thisNodeId) {
			const { type, body } = obj.message;
			const context = { isLocal: false };
			await this.emitLocally(type, body, context);
		}
	}

	@bindThis
	public connect(): void {
		this.redisForSub.on('message', this.onMessage);
	}

	@bindThis
	public disconnect(): void {
		this.redisForSub.off('message', this.onMessage);
	}

	@bindThis
	public dispose(): void {
		this.disconnect();
		this.clearListeners();
	}

	@bindThis
	public onApplicationShutdown(): void {
		this.dispose();
	}

	@bindThis
	public onModuleInit(): void {
		this.connect();
	}
}

function isInternalEventMessage(obj: unknown): obj is InternalEventMessage {
	if (typeof(obj) === 'object' && obj != null) {
		if ('channel' in obj && typeof(obj.channel) === 'string') {
			return obj.channel === 'internal';
		}
	}
	return false;
}
