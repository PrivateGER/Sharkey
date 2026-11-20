/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHmac } from 'node:crypto';

export type ImgproxyConfig = {
	url: string;
	key: string;
	salt: string;
};

/**
 * The media proxy variants, mirroring the query flags of the built-in `/proxy` handler.
 * `firstFrame` asks imgproxy to drop animation via `max_animation_frames:1`,
 * which imgproxy only honours when IMGPROXY_ALLOW_SECURITY_OPTIONS=true.
 */
export type ImgproxyVariant =
	| { kind: 'original' }
	| { kind: 'emoji' | 'avatar', firstFrame: boolean }
	| { kind: 'static' | 'preview' };

// Passed through untouched, like the built-in handler does with browser-safe images.
// imgproxy still sniffs the type, so non-images are rejected.
const passthroughFormats = 'skp:jpg:png:gif:webp:avif';

function variantPath(variant: ImgproxyVariant): { options: string, extension: string } {
	switch (variant.kind) {
		case 'original':
			return { options: passthroughFormats, extension: '' };
		case 'emoji':
			return { options: `rs:fit:0:128${variant.firstFrame ? '/maf:1' : ''}`, extension: '.webp' };
		case 'avatar':
			return { options: `rs:fit:0:320${variant.firstFrame ? '/maf:1' : ''}`, extension: '.webp' };
		case 'static':
			return { options: 'rs:fit:498:422/maf:1', extension: '.webp' };
		case 'preview':
			return { options: 'rs:fit:200:200/maf:1', extension: '.webp' };
	}
}

/** Maps the `/proxy` query flags to the variant the built-in handler would produce. */
export function imgproxyVariantFromQuery(query: object): ImgproxyVariant {
	const firstFrame = 'static' in query;
	if ('emoji' in query) return { kind: 'emoji', firstFrame };
	if ('avatar' in query) return { kind: 'avatar', firstFrame };
	if ('static' in query) return { kind: 'static' };
	if ('preview' in query) return { kind: 'preview' };
	return { kind: 'original' };
}

export function signImgproxyPath(path: string, key: string, salt: string): string {
	return createHmac('sha256', Buffer.from(key, 'hex'))
		.update(Buffer.from(salt, 'hex'))
		.update(path)
		.digest('base64url');
}

export function buildImgproxyUrl(config: ImgproxyConfig, sourceUrl: string, variant: ImgproxyVariant): string {
	const { options, extension } = variantPath(variant);
	const path = `/${options}/${Buffer.from(sourceUrl).toString('base64url')}${extension}`;
	return `${config.url}/${signImgproxyPath(path, config.key, config.salt)}${path}`;
}
