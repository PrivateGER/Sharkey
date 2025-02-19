/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ActivityLogTiming1731909785724 {
    name = 'ActivityLogTiming1731909785724'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "activity_log" ADD "duration" double precision NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "activity_log" ALTER COLUMN "result" DROP NOT NULL`);
    }

    async down(queryRunner) {
				await queryRunner.query(`UPDATE "activity_log" SET "result" = 'not processed' WHERE "result" IS NULL`);
        await queryRunner.query(`ALTER TABLE "activity_log" ALTER COLUMN "result" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "activity_log" DROP COLUMN "duration"`);
		}
}
