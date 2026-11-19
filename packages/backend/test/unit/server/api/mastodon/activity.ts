/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { activityDays, activityWeeks, daysOfActivityWeek, estimateWeeklyActiveUsers } from '@/server/api/mastodon/activity.js';

describe('daysOfActivityWeek', () => {
	it('should make the current week today alone', () => {
		expect(daysOfActivityWeek(0)).toEqual([0]);
	});

	it('should cover every earlier day exactly once', () => {
		const days = Array.from({ length: activityWeeks }, (_, week) => daysOfActivityWeek(week)).flat();

		expect(days.toSorted((a, b) => a - b)).toEqual(Array.from({ length: activityDays }, (_, day) => day));
	});
});

describe('estimateWeeklyActiveUsers', () => {
	const everyDay = (active: number) => Array.from({ length: activityDays }, () => active);

	it('should scale a week by how much adding up days overcounted the last seven', () => {
		// 10 users a day add up to 70 over seven days, but only 20 different users were seen.
		const weeks = estimateWeeklyActiveUsers(everyDay(10), 20);

		expect(weeks).toHaveLength(activityWeeks);
		expect(weeks.slice(1)).toEqual(Array.from({ length: activityWeeks - 1 }, () => 20));
	});

	it('should report today as it is', () => {
		expect(estimateWeeklyActiveUsers(everyDay(10), 20)[0]).toBe(10);
	});

	it('should not go below the busiest day of a week', () => {
		const activeByDay = everyDay(1);
		activeByDay[10] = 50;

		// Days 8 to 14 add up to 56. A seventh of that is 8, but 50 users were there on one day.
		expect(estimateWeeklyActiveUsers(activeByDay, 1)[2]).toBe(50);
	});

	it('should not go above the days of a week added up', () => {
		// More distinct users than daily visits can't be, but the two numbers are read at different moments.
		expect(estimateWeeklyActiveUsers(everyDay(10), 500)[1]).toBe(70);
	});

	it('should report nothing when nobody was active', () => {
		expect(estimateWeeklyActiveUsers(everyDay(0), 0)).toEqual(Array.from({ length: activityWeeks }, () => 0));
	});

	it('should treat days the chart does not reach as empty', () => {
		// Days 1 and 2 add up to 20, and a third of that is less than either day.
		const weeks = estimateWeeklyActiveUsers([10, 10, 10], 10);

		expect(weeks[1]).toBe(10);
		expect(weeks[2]).toBe(0);
	});
});
