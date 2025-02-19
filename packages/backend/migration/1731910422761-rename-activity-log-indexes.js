/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class RenameActivityLogIndexes1731910422761 {
    name = 'RenameActivityLogIndexes1731910422761'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDK_activity_context_md5"`);
		}

    async down(queryRunner) {
				await queryRunner.query(`CREATE INDEX "IDK_activity_context_md5" ON "activity_context" ("md5") `);
    }
}
