/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class SoftLimitDriveComment1728348353115 {
    name = 'SoftLimitDriveComment1728348353115'

    async up(queryRunner) {
			await queryRunner.query(`ALTER TABLE "drive_file" ALTER COLUMN "comment" TYPE text`);
		}

    async down(queryRunner) {
			await queryRunner.query(`ALTER TABLE "drive_file" ALTER COLUMN "comment" TYPE varchar(100000)`);
		}
}
