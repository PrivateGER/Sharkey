/*
* SPDX-FileCopyrightText: piuvas and other Sharkey contributors
* SPDX-License-Identifier: AGPL-3.0-only
*/

import { load as cheerio } from 'cheerio/slim';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { Response } from 'node-fetch';

type Field = { name: string, value: string };

export async function verifyFieldLinks(fields: Field[], profileUrls: string[], httpRequestService: HttpRequestService): Promise<string[]> {
	const verified_links: string[] = [];
	for (const field_url of fields) {
		try {
			// HttpRequestService.send validates the input URL, so we can safely pass in untrusted values
			const response = await httpRequestService.send(field_url.value, { headers: { Accept: 'text/html, */*' } });

			if (hasBacklinkInHeader(response, profileUrls) || await hasBacklinkInBody(response, profileUrls)) {
				verified_links.push(field_url.value);
			}
		} catch {
			// don't do anything.
		}
	}

	return verified_links;
}

/**
 * Checks whether there is a backlink to a user's profile in a site's "Link" header
 *
 * See [RFC 8288 Section 3]{@link https://httpwg.org/specs/rfc8288.html#header} for implementation details
 *
 * @param res - fetch() response of the link to check
 * @param profileUrls - List of all valid links to a user's profile
 * @returns Whether there was a valid backlink to the user
 */
function hasBacklinkInHeader(res: Response, profileUrls: string[]): boolean {
	const linkHeaders = res.headers.get('link');
	if (!linkHeaders) return false;

	for (const linkHeader of linkHeaders.split(/\s*,\s*/g)) {
		const [encodedLinkHref, ...encodedLinkParams] = linkHeader.split(/\s*;\s*/g);

		// check rel is present
		const relParam = encodedLinkParams.map((kv) => kv.split(/\s*=\s*/, 2)).find(([k]) => k === 'rel') as [string, string] | undefined;
		if (!relParam) continue;

		// check rel includes "me"
		// > "any link-param can be generated with values using either the token or the quoted-string syntax;
		//   therefore, recipients MUST be able to parse both forms"
		const unquote = (s: string) => s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
		const rels = unquote(relParam[1]).split(' ');
		if (!rels.includes('me')) continue;

		// decode href
		if (!encodedLinkHref.startsWith('<') || !encodedLinkHref.endsWith('>')) continue;
		const href = decodeURI(encodedLinkHref.slice(1, -1));

		if (profileUrls.includes(href)) return true;
	}

	return false;
}

/**
 * Searches HTML for a backlink to a user's profile
 *
 * @param res - fetch() response of the link to check
 * @param profileUrls - List of all valid links to a user's profile
 * @returns Whether there was a valid backlink to the user
 */
async function hasBacklinkInBody(res: Response, profileUrls: string[]): Promise<boolean> {
	const doc = cheerio(await res.text());
	const links = doc('a[rel~="me"][href], link[rel~="me"][href]').toArray();
	return links.some(link => profileUrls.includes(link.attribs.href));
}
