/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class RenameActivityLogToApInboxLog1733756280460 {
	name = 'RenameActivityLogToApInboxLog1733756280460'

	async up(queryRunner) {
		await queryRunner.query(`ALTER INDEX "IDX_activity_log_at" RENAME TO "IDX_ap_inbox_log_at"`);
		await queryRunner.query(`ALTER INDEX "IDX_activity_log_host" RENAME TO "IDX_ap_inbox_log_host"`);
		await queryRunner.query(`ALTER TABLE "activity_log" RENAME CONSTRAINT "PK_activity_log" TO "PK_ap_inbox_log"`);
		await queryRunner.query(`ALTER TABLE "activity_log" RENAME CONSTRAINT "FK_activity_log_context_hash" TO "FK_ap_inbox_log_context_hash"`);
		await queryRunner.query(`ALTER TABLE "activity_log" RENAME CONSTRAINT "FK_activity_log_auth_user_id" TO "FK_ap_inbox_log_auth_user_id"`);
		await queryRunner.query(`ALTER TABLE "activity_log" RENAME TO "ap_inbox_log"`);

		await queryRunner.query(`ALTER TABLE "activity_context" RENAME CONSTRAINT "PK_activity_context" TO "PK_ap_context"`);
		await queryRunner.query(`ALTER TABLE "activity_context" RENAME TO "ap_context"`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "ap_context" RENAME TO "activity_context"`);
		await queryRunner.query(`ALTER TABLE "activity_context" RENAME CONSTRAINT "PK_ap_context" TO "PK_activity_context"`);

		await queryRunner.query(`ALTER TABLE "ap_inbox_log" RENAME TO "activity_log"`);
		await queryRunner.query(`ALTER TABLE "activity_log" RENAME CONSTRAINT "FK_ap_inbox_log_auth_user_id" TO "FK_activity_log_auth_user_id"`);
		await queryRunner.query(`ALTER TABLE "activity_log" RENAME CONSTRAINT "FK_ap_inbox_log_context_hash" TO "FK_activity_log_context_hash"`);
		await queryRunner.query(`ALTER TABLE "activity_log" RENAME CONSTRAINT "PK_ap_inbox_log" TO "PK_activity_log"`);
		await queryRunner.query(`ALTER INDEX "IDX_ap_inbox_log_host" RENAME TO "IDX_activity_log_host"`);
		await queryRunner.query(`ALTER INDEX "IDX_ap_inbox_log_at" RENAME  TO "IDX_activity_log_at"`);
	}
}
