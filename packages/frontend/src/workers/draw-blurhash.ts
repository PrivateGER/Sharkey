/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { render } from 'buraha';

let canvas = new OffscreenCanvas(64, 64);

function draw(hash: string): ImageBitmap {
	render(hash, canvas);
	return canvas.transferToImageBitmap();
}

onmessage = (event) => {
	// console.log(event.data);
	if (!('id' in event.data && typeof event.data.id === 'string')) {
		return;
	}
	if (!('hash' in event.data && typeof event.data.hash === 'string')) {
		return;
	}

	let bitmap: ImageBitmap;
	try {
		bitmap = draw(event.data.hash);
	} catch {
		// A lost WebGL context (common on Android once the GPU reclaims it) stays lost for this canvas,
		// so every later draw would fail too. A new canvas gets a fresh context.
		canvas = new OffscreenCanvas(64, 64);
		try {
			bitmap = draw(event.data.hash);
		} catch {
			// No usable WebGL context; the component keeps showing the average colour.
			return;
		}
	}
	postMessage({ id: event.data.id, bitmap });
};
