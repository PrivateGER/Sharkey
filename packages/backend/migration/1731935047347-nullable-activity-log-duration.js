/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class NullableActivityLogDuration1731935047347 {
    name = 'NullableActivityLogDuration1731935047347'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "activity_log" ALTER COLUMN "duration" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "activity_log" ALTER COLUMN "duration" DROP DEFAULT`);
				await queryRunner.query(`UPDATE "activity_log" SET "duration" = NULL WHERE "duration" = 0`);
		}

    async down(queryRunner) {
				await queryRunner.query(`UPDATE "activity_log" SET "duration" = 0 WHERE "duration" IS NULL`);
        await queryRunner.query(`ALTER TABLE "activity_log" ALTER COLUMN "duration" SET DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "activity_log" ALTER COLUMN "duration" SET NOT NULL`);
		}
}
