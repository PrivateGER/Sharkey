/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';

/**
 * Provides access to the process environment variables.
 * This exists for testing purposes, so that a test can mock the environment without corrupting state for other tests.
 */
@Injectable()
export class EnvService {
	/**
	 * Passthrough to process.env
	 */
	public get env() {
		return process.env;
	}
}
