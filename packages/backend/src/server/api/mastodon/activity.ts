/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// https://docs.joinmastodon.org/methods/instance/#activity
export const activityWeeks = 12;

/**
 * Number of chart days that the weeks of the activity report reach back, today included.
 */
export const activityDays = 7 * (activityWeeks - 1) + 1;

/**
 * Gets the days that Mastodon reports as one week of activity, as indexes into a chart where 0 is today.
 * The week that started `week` weeks ago runs for seven days from that day, so the current week is today alone
 * and every earlier one ends the day before the next one starts.
 */
export function daysOfActivityWeek(week: number): number[] {
	if (week === 0) return [0];
	return Array.from({ length: 7 }, (_, day) => 7 * week - day);
}

/**
 * Estimates how many distinct users were active in each week, from how many were active on each day.
 *
 * The days of a week can't simply be added up, because that counts a user once for every day they were active.
 * How much it overcounts is measured on the last seven days, for which the true number is known, and the same
 * correction is applied to the other weeks. That assumes users come back about as often in every week.
 *
 * @param activeByDay distinct active users on each day, where 0 is today
 * @param activeLastSevenDays distinct active users over days 0 to 6 together
 * @returns estimate for each week of the activity report, starting with the current one
 */
export function estimateWeeklyActiveUsers(activeByDay: number[], activeLastSevenDays: number): number[] {
	const lastSevenDays = activeByDay.slice(0, 7);
	const addedUp = sum(lastSevenDays);
	// A user is counted between once and seven times, however the measurement turns out.
	const distinctShare = addedUp > 0 ? Math.min(1, Math.max(1 / 7, activeLastSevenDays / addedUp)) : 1;

	return Array.from({ length: activityWeeks }, (_, week) => {
		const days = daysOfActivityWeek(week).map(day => activeByDay[day] ?? 0);
		// The busiest day is the least a week can have, and the sum of its days the most.
		return Math.min(sum(days), Math.max(Math.max(...days), Math.round(sum(days) * distinctShare)));
	});
}

export function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
