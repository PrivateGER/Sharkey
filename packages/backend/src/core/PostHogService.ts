/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import cluster from 'node:cluster';
import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { PostHog, type SpanAttributes } from 'posthog-node';
import { SeverityNumber, type Logger as OtelLogger } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import type { Config, PostHogConfig } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { EnvService } from '@/global/EnvService.js';

export type PostHogProperties = Record<string, string | number | boolean | null | undefined>;

export type PostHogContext = {
	properties: PostHogProperties;
	/** The authenticated user of the current request. */
	actor?: { id: string; username: string };
};

/** First-party path that relays browser analytics to `posthog.host` (PostHogProxyServerService). */
export const postHogProxyPath = '/ph';

/**
 * Owns the instance's PostHog clients. Capturing is a no-op when `posthog` is not configured.
 */
@Injectable()
export class PostHogService implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly client: PostHog | null = null;
	private readonly logProvider: LoggerProvider | null = null;
	private readonly logger: OtelLogger | null = null;
	private readonly context = new AsyncLocalStorage<PostHogContext>();
	/**
	 * Open while a traced user request runs. PostHog's own active span stays visible to async work
	 * that outlives the request, so it can't tell whether we're still inside one.
	 */
	private readonly requestScope = new AsyncLocalStorage<{ open: boolean }>();

	constructor(
		@Inject(DI.config)
		private config: Config,
		envService: EnvService,
	) {
		if (!config.posthog) return;

		const environment = envService.env.NODE_ENV ?? 'production';

		this.client = new PostHog(config.posthog.projectToken, {
			host: config.posthog.host,
			privacyMode: true,
			traces: {
				serviceName: 'sharkey-backend',
				serviceVersion: config.version,
				environment,
			},
		});

		this.logProvider = new LoggerProvider({
			resource: resourceFromAttributes({
				'service.name': 'sharkey-backend',
				'deployment.environment': environment,
			}),
			processors: [new BatchLogRecordProcessor(new OTLPLogExporter({
				url: postHogUrl(config.posthog, 'i/v1/logs'),
				headers: { Authorization: `Bearer ${config.posthog.projectToken}` },
			}))],
		});
		this.logger = this.logProvider.getLogger('sharkey');
	}

	/**
	 * `username` is stored on the PostHog person; when omitted, it comes from the request context
	 * if the event belongs to the authenticated user. Local usernames are immutable, hence `$set_once`.
	 */
	@bindThis
	public capture(distinctId: string, event: string, properties?: PostHogProperties, username?: string): void {
		const store = this.context.getStore();
		const personUsername = username ?? (store?.actor?.id === distinctId ? store.actor.username : undefined);
		this.client?.capture({
			distinctId,
			event,
			properties: {
				...store?.properties,
				...properties,
				sharkey_version: this.config.version,
				...(personUsername !== undefined ? { $set_once: { username: personUsername } } : {}),
			},
		});
	}

	@bindThis
	public runWithContext<T>(context: PostHogContext, fn: () => T): T {
		return this.context.run(context, fn);
	}

	/**
	 * Traces an API request made by a user. Only user-initiated requests are traced;
	 * background work such as federation queues is deliberately left out.
	 */
	@bindThis
	public traceUserRequest<T>(distinctId: string, name: string, attributes: SpanAttributes, fn: () => Promise<T>): Promise<T> {
		const client = this.client;
		if (!client) return fn();

		const scope = { open: true };
		// The PostHog context links the span to the user's person.
		return this.requestScope.run(scope, () => client.withContext({ distinctId }, () => client.withSpan(name, { kind: 'server', attributes }, async (span) => {
			try {
				return await fn();
			} catch (err) {
				// API errors carry a stable code, which is easier to group by than the message.
				if (err instanceof Error && 'code' in err && typeof err.code === 'string') span.setAttribute('error.code', err.code);
				throw err;
			} finally {
				scope.open = false;
			}
		})));
	}

	/**
	 * Times a step of user-facing work. It only becomes a span while a user request traced by
	 * traceUserRequest is running, so the same code running for federation or queues is never traced.
	 */
	@bindThis
	public withSpan<T>(name: string, attributes: SpanAttributes, fn: () => Promise<T>): Promise<T> {
		if (!this.client || !this.requestScope.getStore()?.open) return fn();
		return this.client.withSpan(name, { attributes }, fn);
	}

	/** Marks the current step as failed, for errors that are handled instead of rethrown. */
	@bindThis
	public recordError(err: unknown): void {
		if (!this.requestScope.getStore()?.open) return;
		this.client?.getActiveSpan()?.recordException(err);
	}

	/** Runs work that continues after the response outside the request, so it isn't traced. */
	@bindThis
	public runDetached<T>(fn: () => T): T {
		return this.requestScope.exit(fn);
	}

	@bindThis
	public log(message: string, attributes?: Record<string, string | number | boolean>): void {
		this.logger?.emit({ severityNumber: SeverityNumber.INFO, severityText: 'info', body: message, attributes });
	}

	@bindThis
	public onApplicationBootstrap(): void {
		this.log('server_boot_started', {
			process_type: cluster.isPrimary ? 'master' : 'worker',
			sharkey_version: this.config.version,
		});
	}

	@bindThis
	public async onApplicationShutdown(): Promise<void> {
		await Promise.allSettled([
			this.client?.shutdown(),
			this.logProvider?.shutdown(),
		]);
	}
}

/**
 * Resolves an API path against the configured host without discarding a path prefix,
 * so reverse-proxied hosts such as `https://example.com/ingest` keep working.
 */
function postHogUrl(config: PostHogConfig, path: string): string {
	const base = config.host.endsWith('/') ? config.host : `${config.host}/`;
	return new URL(path, base).toString();
}
