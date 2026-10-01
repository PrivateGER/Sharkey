/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createRequire } from 'node:module';
import { context, createContextKey, SpanKind, SpanStatusCode, trace, type Attributes, type Context, type Span, type Tracer } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, BatchSpanProcessor, SamplingDecision, type ReadableSpan, type Sampler, type SamplingResult, type SpanProcessor } from '@opentelemetry/sdk-trace-base';

export type PostHogTracingOptions = {
	tracesUrl: string;
	projectToken: string;
	serviceVersion: string;
	environment: string;
	/**
	 * Whether to auto-instrument Postgres, Redis and outgoing HTTP. Sentry's tracing installs the same
	 * instrumentation packages, and a second instance would unwrap Sentry's patches.
	 */
	instrumentLibraries: boolean;
};

type RequestState = { open: boolean };

const requestKey = createContextKey('sharkey.posthog.request');
const distinctIdKey = createContextKey('sharkey.posthog.distinctId');

/** Spans we are recording that have not ended yet. */
const openSpans = new WeakSet<object>();

/** URL attributes from the HTTP instrumentations; paths and queries can carry emails and API keys. */
const urlAttributes = ['http.url', 'url.full'];
const pathAttributes = ['http.target', 'url.path', 'url.query'];

let tracer: Tracer | null = null;
let provider: BasicTracerProvider | null = null;
let exporter: OTLPTraceExporter | null = null;

/**
 * Spans are recorded only while a user request traced by {@link traceUserRequest} is still running,
 * and only under one of our own open spans. Background work (queues, federation, anything that
 * outlives the request) is dropped, and so are spans parented by another tracer such as Sentry's.
 */
function isTracedRequest(ctx: Context): boolean {
	// Only traceUserRequest writes this key.
	const request = ctx.getValue(requestKey) as RequestState | undefined;
	if (!request?.open) return false;
	const parent = trace.getSpan(ctx);
	return parent === undefined || openSpans.has(parent);
}

const userRequestSampler: Sampler = {
	shouldSample(parentContext: Context): SamplingResult {
		return { decision: isTracedRequest(parentContext) ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD };
	},
	toString: () => 'SharkeyUserRequestSampler',
};

const openSpanTracker: SpanProcessor = {
	onStart(span, parentContext) {
		openSpans.add(span);
		// PostHog links spans to persons through this attribute.
		const distinctId = parentContext.getValue(distinctIdKey);
		if (typeof distinctId === 'string') span.setAttribute('posthogDistinctId', distinctId);
	},
	onEnding(span) {
		for (const key of urlAttributes) {
			const url = span.attributes[key];
			if (typeof url === 'string') span.setAttribute(key, URL.canParse(url) ? new URL(url).origin : '[redacted]');
		}
		for (const key of pathAttributes) {
			if (key in span.attributes) span.setAttribute(key, '[redacted]');
		}
	},
	onEnd(span: ReadableSpan) {
		openSpans.delete(span);
	},
	forceFlush: () => Promise.resolve(),
	shutdown: () => Promise.resolve(),
};

/**
 * Starts exporting traces to PostHog and instruments Postgres, Redis and outgoing HTTP.
 * Tracing is process-wide, so later calls (one per Nest application in the process) do nothing.
 */
export function startPostHogTracing(options: PostHogTracingOptions): void {
	if (provider) return;

	exporter = new OTLPTraceExporter({
		url: options.tracesUrl,
		headers: { Authorization: `Bearer ${options.projectToken}` },
	});
	provider = new BasicTracerProvider({
		resource: resourceFromAttributes({
			'service.name': 'sharkey-backend',
			'service.version': options.serviceVersion,
			'deployment.environment': options.environment,
		}),
		sampler: userRequestSampler,
		spanProcessors: [
			openSpanTracker,
			new BatchSpanProcessor(exporter, {
				// TypeORM statements can run to tens of kilobytes; this keeps a batch well under PostHog's 10 MB request limit.
				maxExportBatchSize: 128,
			}),
		],
	});
	tracer = provider.getTracer('sharkey');

	// Fails harmlessly when Sentry has already registered its own AsyncLocalStorage-based manager.
	context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
	if (!options.instrumentLibraries) return;

	const tracesOrigin = new URL(options.tracesUrl).origin;
	registerInstrumentations({
		tracerProvider: provider,
		instrumentations: [
			new PgInstrumentation({
				requireParentSpan: true,
				requestHook: (span, { query }) => span.updateName(sqlSpanName(query.text)),
			}),
			// The default serializer includes EVALSHA arguments, which hold whole BullMQ job payloads (webhook secrets included).
			new IORedisInstrumentation({ requireParentSpan: true, dbStatementSerializer: (command) => command }),
			new HttpInstrumentation({ disableIncomingRequestInstrumentation: true, requireParentforOutgoingSpans: true }),
			new UndiciInstrumentation({
				requireParentforSpans: true,
				// posthog-node flushes from whatever context called capture(), which may be a traced request.
				ignoreRequestHook: (request) => request.origin === tracesOrigin,
			}),
		],
	});

	// The instrumentations patch a module when it is next required, but pg (loaded by TypeORM) and
	// ioredis/http (imported by ESM, which bypasses require hooks) are already loaded by now.
	// Requiring them again applies the patches to the shared module objects.
	const require = createRequire(import.meta.url);
	for (const name of ['pg', 'ioredis', 'http', 'https']) require(name);
	createRequire(require.resolve('pg'))('pg-pool');
}

export async function flushPostHogTracing(): Promise<void> {
	try {
		await provider?.forceFlush();
	} finally {
		// The provider only flushes buffered spans; this waits for a batch that is already being sent.
		await exporter?.forceFlush();
	}
}

/**
 * Names a query span after its statement and main table, e.g. `SELECT note`, so PostHog's
 * per-operation aggregates separate tables instead of lumping every SELECT together.
 */
export function sqlSpanName(sql: string): string {
	const match = /^\s*(?:(SELECT|DELETE)\b[\s\S]*?\bFROM|(INSERT)\s+INTO|(UPDATE))\s+"?(\w+)"?/i.exec(sql);
	if (match) return `${(match[1] ?? match[2] ?? match[3]).toUpperCase()} ${match[4]}`;
	return /^\s*(\w+)/.exec(sql)?.[1].toUpperCase() ?? 'SQL';
}

/** HttpRequestService errors embed the request URL, whose query can hold third-party API keys. */
function stripUrlQueries(text: string): string {
	return text.replace(/(https?:\/\/[^\s?#]+)[?#]\S*/gi, '$1');
}

function recordFailure(span: Span, err: unknown): void {
	const message = stripUrlQueries(err instanceof Error ? err.message : String(err));
	span.recordException({
		name: err instanceof Error ? err.name : undefined,
		message,
		stack: err instanceof Error && err.stack ? stripUrlQueries(err.stack) : undefined,
	});
	span.setStatus({ code: SpanStatusCode.ERROR, message });
}

/**
 * Traces an API request made by a user. This is the only place traces start,
 * so background work such as federation queues is never traced.
 */
export async function traceUserRequest<T>(distinctId: string, name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
	if (!tracer) return await fn();

	const request: RequestState = { open: true };
	const requestContext = context.active().setValue(distinctIdKey, distinctId).setValue(requestKey, request);
	const span = tracer.startSpan(name, { kind: SpanKind.SERVER, attributes, root: true }, requestContext);
	try {
		return await context.with(trace.setSpan(requestContext, span), fn);
	} catch (err) {
		recordFailure(span, err);
		// API errors carry a stable code, which is easier to group by than the message.
		if (err instanceof Error && 'code' in err && typeof err.code === 'string') span.setAttribute('error.code', err.code);
		throw err;
	} finally {
		request.open = false;
		span.end();
	}
}

/** Times a step of a traced user request. Outside one, it just runs `fn`. */
export async function withSpan<T>(name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
	if (!tracer || !isTracedRequest(context.active())) return await fn();

	const span = tracer.startSpan(name, { attributes });
	try {
		return await context.with(trace.setSpan(context.active(), span), fn);
	} catch (err) {
		recordFailure(span, err);
		throw err;
	} finally {
		span.end();
	}
}

/**
 * Method decorator form of {@link withSpan} for async methods. Apply it below `@bindThis`.
 * `attributes` receives the call's arguments.
 */
export function traced<A extends unknown[]>(name: string, attributes?: (...args: A) => Attributes) {
	return function (target: object, key: string, descriptor: PropertyDescriptor) {
		const fn: unknown = descriptor.value;
		if (typeof fn !== 'function') {
			throw new TypeError(`@traced can only be applied to methods, not ${key}: ${typeof fn}`);
		}

		descriptor.value = function (this: unknown, ...args: A) {
			return withSpan(name, attributes?.(...args) ?? {}, () => fn.apply(this, args));
		};
	};
}

/** Marks the current step as failed, for errors that are handled instead of rethrown. */
export function recordSpanError(err: unknown): void {
	const ctx = context.active();
	const span = trace.getSpan(ctx);
	if (span && isTracedRequest(ctx)) recordFailure(span, err);
}

/** Runs work that continues after the response outside the request, so it isn't traced. */
export function runDetached<T>(fn: () => T): T {
	return context.with(trace.deleteSpan(context.active()).deleteValue(requestKey), fn);
}
