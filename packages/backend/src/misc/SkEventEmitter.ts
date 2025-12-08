/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { bindThis } from '@/decorators.js';
import { callAllAsync } from '@/misc/call-all.js';

export interface SkEventEmitter<TEvents extends AnyEvents, TProps extends ListenerProps = ListenerProps> {
	on<K extends keyof TEvents>(type: K, listener: EventListener<TEvents, K>, props?: Partial<TProps>): void;
	off<K extends keyof TEvents>(type: K, listener: EventListener<TEvents, K>): void;
}

export class SkEventSource<TEvents extends AnyEvents, TProps extends ListenerProps = ListenerProps, TContext extends object = Record<string, never>> implements SkEventEmitter<TEvents, TProps> {
	// Event -> (Listener -> Props)
	private readonly listeners = new Map<keyof TEvents, Map<AnyListener, Partial<TProps>>>();

	@bindThis
	public on<K extends keyof TEvents>(type: K, listener: EventListener<TEvents, K>, props?: Partial<TProps>): void {
		let set = this.listeners.get(type);
		if (!set) {
			set = new Map();
			this.listeners.set(type, set);
		}

		// Functionally, this is just a set with metadata on the values.
		set.set(listener as AnyListener, props ?? {});
	}

	@bindThis
	public off<K extends keyof TEvents>(type: K, listener: EventListener<TEvents, K>): void {
		this.listeners.get(type)?.delete(listener as AnyListener);
	}

	@bindThis
	public async emit<K extends keyof TEvents>(type: K, value: TEvents[K], context?: TContext): Promise<void> {
		const listenersForType = this.listeners.get(type);
		if (!listenersForType || listenersForType.size < 1) {
			return;
		}

		// Filter listeners based on context
		const listeners = (listenersForType as Map<EventListener<TEvents, K>, Partial<TProps>>)
			.entries()
			.filter(reg => this.filterListener(type, value, reg, context ?? {}))
			.toArray();

		// Remove oneShot listeners
		for (const [listener, props] of listeners) {
			if (props.oneShot) {
				listenersForType.delete(listener as AnyListener);
			}
		}

		// Execute listeners only *after* everything is up to date
		await this.emitInternal(type, value, listeners as [EventListener<TEvents, K>, Partial<TProps>][]);
	}

	/**
	 * Subclasses can override this to filter listeners for a particular event emission.
	 * Return true to execute them, or false to skip.
	 *
	 * Default implementation returns true (execute) for all listeners.
	 */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	protected filterListener<K extends keyof TEvents>(type: K, value: TEvents[K], registration: [EventListener<TEvents, K>, Partial<TProps>], context: Partial<TContext>): boolean {
		return true;
	}

	/**
	 * Executes all listeners in the provided set.
	 * The default behavior synchronously executes each listener, then asynchronously waits for all returned promises to resolve.
	 * In effect, synchronous code runs in strict order without concurrency, but async code is executed all at the same time.
	 *
	 * Whether the listener is sync or async, errors are captured and suppressed until after all listeners have completed.
	 * At that point, an AggregateError will be thrown containing all error(s) thrown by any listener.
	 * (no error is thrown if all listeners succeeded.)
	 *
	 * Subclasses can override this to modify the event-dispatch behavior, with consideration for a few constraints:
	 * * Callers generally expect all events to emit, even if an unrelated one throws an error.
	 *   If this behavior is changed, then it should be clearly documented.
	 * * When this method is called, one-shot listeners have *already* been removed from the listener set.
	 *   There is no need to manually remove them a second time.
	 */
	protected async emitInternal<K extends keyof TEvents>(type: K, value: TEvents[K], registrations: [EventListener<TEvents, K>, Partial<TProps>][]) {
		const listeners = registrations.map(r => r[0]);
		await callAllAsync(listeners, value, type);
	}

	@bindThis
	protected clearListeners() {
		this.listeners.clear();
	}
}

export interface ListenerProps {
	/**
	 * If true, this listener will only fire once. After that, it will be automatically removed.
	 * If false (default), this listener will fire every time the event is emitted, until manually removed.
	 */
	oneShot?: boolean;
}

export type EventListener<TEvents extends AnyEvents, K extends keyof TEvents> = (value: TEvents[K], key: K) => void | Promise<void>;

// This makes TypeScript shut up about calls to Parameter<TEvents[K]>
export type AnyEvents = Readonly<Record<string, object>>;

// This makes TypeScript shut up about casting Listener<K> to Listener<keyof TEvents>
export type AnyListener = (value: unknown, key: string) => void | Promise<void>;
