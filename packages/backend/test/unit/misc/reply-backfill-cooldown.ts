/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getAutoBackfillCooldown } from '@/misc/reply-backfill-cooldown.js';

const minute = 1000 * 60;
const hour = minute * 60;
const day = hour * 24;

describe(getAutoBackfillCooldown, () => {
	it('should recheck a just-active thread after five minutes', () => {
		expect(getAutoBackfillCooldown(0)).toBe(5 * minute);
		expect(getAutoBackfillCooldown(10 * minute)).toBe(5 * minute);
	});

	it('should wait a quarter of the idle time in between', () => {
		expect(getAutoBackfillCooldown(4 * hour)).toBe(hour);
		expect(getAutoBackfillCooldown(day)).toBe(6 * hour);
	});

	it('should wait at most a week', () => {
		expect(getAutoBackfillCooldown(60 * day)).toBe(7 * day);
	});

	it('should still backfill a thread idle for exactly 90 days', () => {
		expect(getAutoBackfillCooldown(90 * day)).toBe(7 * day);
	});

	it('should not backfill a thread idle for more than 90 days', () => {
		expect(getAutoBackfillCooldown(90 * day + 1)).toBeNull();
	});

	it('should treat activity dated in the future as just active', () => {
		expect(getAutoBackfillCooldown(-hour)).toBe(5 * minute);
	});
});
