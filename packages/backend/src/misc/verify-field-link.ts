/*
* SPDX-FileCopyrightText: piuvas and other Sharkey contributors
* SPDX-License-Identifier: AGPL-3.0-only
*/

import { JSDOM } from 'jsdom';
import type { HttpRequestService } from '@/core/HttpRequestService.js';

type Field = { name: string, value: string };

export async function verifyFieldLinks(fields: Field[], profile_url: string, httpRequestService: HttpRequestService): Promise<string[]> {
	const verified_links = [];
	for (const field_url of fields
		.filter(x => URL.canParse(x.value) && ['http:', 'https:'].includes((new URL(x.value).protocol)))) {
		try {
			const html = await httpRequestService.getHtml(field_url.value);

			const { window } = new JSDOM(html);
			const doc: Document = window.document;

			const aEls = Array.from(doc.getElementsByTagName('a'));
			const linkEls = Array.from(doc.getElementsByTagName('link'));

			const includesProfileLinks = [...aEls, ...linkEls].some(link => link.rel === 'me' && link.href === profile_url);
			if (includesProfileLinks) { verified_links.push(field_url.value); }

			window.close();
		} catch (err) {
			// don't do anything.
			continue;
		}
	}
	return verified_links;
}
