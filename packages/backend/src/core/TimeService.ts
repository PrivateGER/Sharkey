/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';

/**
 * Provides abstractions to access the current time.
 * Exists for unit testing purposes, so that tests can "simulate" any given time for consistency.
 */
@Injectable()
export class TimeService {
	/**
	 * Returns Date.now()
	 */
	public get now() {
		return Date.now();
	}

	/**
	 * Returns a new Date instance.
	 */
	public get date() {
		return new Date();
	}
}
