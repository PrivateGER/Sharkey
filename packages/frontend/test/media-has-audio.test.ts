import { afterEach, describe, expect, test, vi } from 'vitest';
import hasAudio from '@/utility/media-has-audio.js';

describe('hasAudio', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('reports audio when the browser blocks playback, so callers do not try to autoplay', async () => {
		vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));

		await expect(hasAudio(window.document.createElement('video'))).resolves.toBe(true);
	});
});
