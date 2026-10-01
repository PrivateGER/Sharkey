/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import cluster from 'node:cluster';
import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { PostHog } from 'posthog-node';
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

	constructor(
		@Inject(DI.config)
		private config: Config,
		envService: EnvService,
	) {
		if (!config.posthog) return;

		this.client = new PostHog(config.posthog.projectToken, {
			host: config.posthog.host,
			privacyMode: true,
		});

		this.logProvider = new LoggerProvider({
			resource: resourceFromAttributes({
				'service.name': 'sharkey-backend',
				'deployment.environment': envService.env.NODE_ENV ?? 'production',
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
