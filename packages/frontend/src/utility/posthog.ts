/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { entities } from 'misskey-js';
import type { PostHog } from 'posthog-js/dist/module.no-external.js';

let client: PostHog | undefined;

function sanitizeUrls(properties: Record<string, unknown> | undefined): void {
	if (!properties) return;

	for (const [key, value] of Object.entries(properties)) {
		if (typeof value === 'string' && /^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
			try {
				const url = new URL(value);
				url.search = '';
				url.hash = '';
				properties[key] = url.href;
			} catch { /* Leave unparseable URLs unchanged. */ }
		} else if (value !== null && typeof value === 'object') {
			// Exception stack frames also contain URLs, nested inside arrays of objects.
			sanitizeUrls(value as Record<string, unknown>);
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
				sanitizeUrls(event.properties);
				sanitizeUrls(event.$set);
				sanitizeUrls(event.$set_once);
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

export function resetPostHog(): void {
	client?.reset();
}
