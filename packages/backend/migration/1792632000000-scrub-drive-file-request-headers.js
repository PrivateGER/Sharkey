/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// drive/files/create used to store the full incoming request headers, including
// the API token in "authorization" and session cookies, into drive_file.requestHeaders
// when enableIpLogging was on. Remove those credentials from existing rows.
// This cannot be undone, so down() is a no-op.
export class ScrubDriveFileRequestHeaders1792632000000 {
	name = 'ScrubDriveFileRequestHeaders1792632000000'

	async up(queryRunner) {
		await queryRunner.query(`UPDATE "drive_file" SET "requestHeaders" = "requestHeaders" - 'authorization' - 'proxy-authorization' - 'cookie' WHERE jsonb_typeof("requestHeaders") = 'object' AND "requestHeaders" ?| array['authorization', 'proxy-authorization', 'cookie']`);
	}

	async down(queryRunner) {
		// Removed credentials cannot be restored.
	}
}
