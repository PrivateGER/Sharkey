/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const minute = 1000 * 60;
const day = minute * 60 * 24;

/**
 * Longest wait between automatic backfills of the same thread.
 */
export const maxAutoBackfillCooldown = 7 * day;

/**
 * Decides how long to wait before automatically backfilling a thread's replies again.
 * Activity in a thread falls off quickly, so the wait grows with the time since the thread's last known activity.
 * @param idleMs Time since the newest known note in the thread
 * @returns Cooldown in milliseconds, or null if the thread has been quiet for too long to backfill automatically
 */
export function getAutoBackfillCooldown(idleMs: number): number | null {
	if (idleMs > 90 * day) return null;
	return Math.min(Math.max(idleMs / 4, 5 * minute), maxAutoBackfillCooldown);
}
