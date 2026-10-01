/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { entities } from 'misskey-js';
import type { PostHog } from 'posthog-js/dist/module.no-external.js';
import type { PathResolvedResult } from '@/lib/nirax.js';

let client: PostHog | undefined;

// Route params that carry credentials: password reset, email verification, unsubscribe, OAuth and MiAuth sessions.
const secretRouteParams = ['token', 'code', 'session'];

type PathMasker = (pathname: string) => string;

function createPathMasker(router: { resolve(path: string): PathResolvedResult | null }): PathMasker {
	return (pathname) => {
		const secrets = new Map<string, string>();
		for (let resolved = router.resolve(pathname); resolved; resolved = resolved.child ?? null) {
			for (const name of secretRouteParams) {
				const value = resolved.props.get(name);
				if (typeof value === 'string' && value !== '') secrets.set(value, name);
			}
		}
		if (secrets.size === 0) return pathname;

		return pathname.split('/').map(segment => {
			let decoded = segment;
			try {
				decoded = decodeURIComponent(segment);
			} catch { /* Compare the raw segment. */ }
			const name = secrets.get(decoded);
			return name ? `:${name}` : segment;
		}).join('/');
	};
}

function sanitizeUrls(properties: Record<string, unknown> | undefined, maskPath: PathMasker): void {
	if (!properties) return;

	for (const [key, value] of Object.entries(properties)) {
		if (typeof value === 'string' && /^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
			try {
				const url = new URL(value);
				url.search = '';
				url.hash = '';
				if (url.origin === window.location.origin) url.pathname = maskPath(url.pathname);
				properties[key] = url.href;
			} catch { /* Leave unparseable URLs unchanged. */ }
		} else if (typeof value === 'string' && key.endsWith('pathname') && value.startsWith('/')) {
			properties[key] = maskPath(value);
		} else if (value !== null && typeof value === 'object') {
			// Exception stack frames also contain URLs, nested inside arrays of objects.
			sanitizeUrls(value as Record<string, unknown>, maskPath);
		}
	}
}

export async function initPostHog(
	config: { projectToken: string; host: string },
	user: Pick<entities.MeDetailed, 'id' | 'isBot' | 'isModerator' | 'isAdmin' | 'createdAt'> | null,
	versions: { server: string; client: string },
): Promise<void> {
	// Disabled instances must not download or execute the browser SDK.
	const [{ default: posthog }, , { mainRouter }] = await Promise.all([
		import('posthog-js/dist/module.no-external.js'),
		import('posthog-js/dist/exception-autocapture.js'),
		import('@/router.js'),
	]);

	const maskPath = createPathMasker(mainRouter);

	posthog.init(config.projectToken, {
		api_host: config.host,
		autocapture: false,
		capture_pageview: 'history_change',
		capture_pageleave: false,
		capture_performance: false,
		disable_session_recording: true,
		capture_heatmaps: false,
		capture_dead_clicks: false,
		disable_surveys: true,
		disable_external_dependency_loading: true,
		person_profiles: 'identified_only',
		// before_send never sees the /flags request, which would otherwise upload the
		// unsanitized initial URL as person properties. It also stops project settings
		// from remotely enabling features that this config turns off.
		advanced_disable_flags: true,
		// Avoid a PostHog cookie being attached to every request to this instance.
		persistence: 'localStorage',
		capture_exceptions: {
			capture_unhandled_errors: true,
			capture_unhandled_rejections: true,
			capture_console_errors: false,
		},
		before_send: (event) => {
			if (event) {
				// Resolve the event URL rather than relying on history/router listener ordering.
				const url = typeof event.properties.$current_url === 'string' ? event.properties.$current_url : window.location.href;
				let resolved = mainRouter.resolve(new URL(url).pathname);
				let route: string | null = null;
				if (resolved !== null && resolved.route.path !== '/:(*)') {
					route = resolved.route.path;
					while (resolved.child) {
						resolved = resolved.child;
						route = route.replace(/\/$/, '') + resolved.route.path;
					}
				}
				event.properties.route = route;
				sanitizeUrls(event.properties, maskPath);
				sanitizeUrls(event.$set, maskPath);
				sanitizeUrls(event.$set_once, maskPath);
			}
			return event;
		},
		loaded: () => {
			if (user !== null && posthog.get_property('$user_state') === 'identified' && posthog.get_distinct_id() !== user.id) {
				posthog.reset();
			}
			// sharkey_version matches server events; client_version identifies the loaded bundle, which can lag a deploy.
			posthog.register({ sharkey_version: versions.server, client_version: versions.client });
			if (user === null) return;
			posthog.identify(user.id, {
				is_bot: user.isBot ?? false,
				is_moderator: user.isModerator ?? false,
				is_admin: user.isAdmin ?? false,
				account_created_at: user.createdAt,
			});
		},
	});
	client = posthog;
}

export function capturePostHogEvent(event: string, properties?: Record<string, string | number | boolean | null>): void {
	client?.capture(event, properties);
}

/** How the confirmed alt text relates to an AI generation in the caption dialog. */
export type GeneratedAltText = { edited: boolean; modelType: 'fast' | 'quality' | 'experimental' };

/** Call once the caption has been persisted, so failed saves aren't counted. */
export function captureAltTextApplied(generated: GeneratedAltText | null): void {
	if (generated === null) return;
	capturePostHogEvent('alt_text_applied', { edited: generated.edited, model_type: generated.modelType });
}

export function resetPostHog(): void {
	client?.reset();
}
