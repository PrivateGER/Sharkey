/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Non-standard, browser-specific ways to tell whether media has an audio track, plus `playsInline`,
// which only video elements have.
type AudioProbes = {
	audioTracks?: { length: number };
	mozHasAudio?: boolean;
	webkitAudioDecodedByteCount?: number;
	playsInline?: boolean;
};

export default async function hasAudio(media: HTMLMediaElement) {
	const cloned = media.cloneNode() as HTMLMediaElement & AudioProbes;
	cloned.muted = true;
	cloned.playsInline = true;
	try {
		await cloned.play();
	} catch {
		// Autoplay is blocked (some browsers block muted playback too), so the tracks can't be inspected.
		// Reporting audio keeps callers from trying to autoplay, which would be blocked as well.
		cloned.remove();
		return true;
	}
	const result = !!cloned.audioTracks?.length || !!cloned.mozHasAudio || !!cloned.webkitAudioDecodedByteCount;
	cloned.remove();
	return result;
}
