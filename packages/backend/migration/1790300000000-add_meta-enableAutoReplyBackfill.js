/*
 * SPDX-FileCopyrightText: PrivateGER and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddMetaEnableAutoReplyBackfill1790300000000 {
	name = 'AddMetaEnableAutoReplyBackfill1790300000000'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" ADD "enableAutoReplyBackfill" boolean NOT NULL DEFAULT true`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableAutoReplyBackfill"`);
	}
}
