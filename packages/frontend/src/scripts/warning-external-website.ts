/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { instance } from '@/instance.js';
import { defaultStore } from '@/store.js';
import * as os from '@/os.js';
import MkUrlWarningDialog from '@/components/MkUrlWarningDialog.vue';

const isRegExp = /^\/(.+)\/(.*)$/;

function extractHostname(maybeUrl: string): URL | null {
	try {
		const url = new URL(maybeUrl);
		return url.host;
	} catch {
		return null;
	}
}

export async function warningExternalWebsite(url: string) {
	const hostname = extractHostname(url);

	if (!hostname) return false;

	const isTrustedByInstance = instance.trustedLinkUrlPatterns.some(expression => {
		const r = isRegExp.exec(expression);

		if (r) {
			return new RegExp(r[1], r[2]).test(url);
		} else if (expression.includes(' ')) {
			return expression.split(' ').every(keyword => url.includes(keyword));
		} else {
			return `.${hostname}`.endsWith(`.${expression}`);
		}
	});

	const isTrustedByUser = defaultStore.reactiveState.trustedDomains.value.includes(hostname);
	const isDisabledByUser = !defaultStore.reactiveState.warnExternalUrl.value;

	if (!isTrustedByInstance && !isTrustedByUser && !isDisabledByUser) {
		const confirm = await new Promise<{ canceled: boolean }>(resolve => {
			const { dispose } = os.popup(MkUrlWarningDialog, {
				url,
			}, {
				done: result => {
					resolve(result ?? { canceled: true });
				},
				closed: () => dispose(),
			});
		});

		if (confirm.canceled) return false;

		return window.open(url, '_blank', 'nofollow noopener popup=false');
	}

	return window.open(url, '_blank', 'nofollow noopener popup=false');
}
