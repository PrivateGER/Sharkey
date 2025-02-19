/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddActivityLog1731565470048 {
    name = 'AddActivityLog1731565470048'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "activity_context" ("md5" text NOT NULL, "json" jsonb NOT NULL, CONSTRAINT "PK_activity_context" PRIMARY KEY ("md5"))`);
        await queryRunner.query(`CREATE INDEX "IDK_activity_context_md5" ON "activity_context" ("md5") `);
        await queryRunner.query(`CREATE TABLE "activity_log" ("id" character varying(32) NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL, "key_id" text NOT NULL, "host" text NOT NULL, "verified" boolean NOT NULL, "accepted" boolean NOT NULL, "result" text NOT NULL, "activity" jsonb NOT NULL, "context_hash" text, "auth_user_id" character varying(32), CONSTRAINT "PK_activity_log" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_activity_log_at" ON "activity_log" ("at") `);
        await queryRunner.query(`CREATE INDEX "IDX_activity_log_host" ON "activity_log" ("host") `);
        await queryRunner.query(`ALTER TABLE "activity_log" ADD CONSTRAINT "FK_activity_log_context_hash" FOREIGN KEY ("context_hash") REFERENCES "activity_context"("md5") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activity_log" ADD CONSTRAINT "FK_activity_log_auth_user_id" FOREIGN KEY ("auth_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "activity_log" DROP CONSTRAINT "FK_activity_log_auth_user_id"`);
        await queryRunner.query(`ALTER TABLE "activity_log" DROP CONSTRAINT "FK_activity_log_context_hash"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_activity_log_host"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_activity_log_at"`);
        await queryRunner.query(`DROP TABLE "activity_log"`);
        await queryRunner.query(`DROP INDEX "public"."IDK_activity_context_md5"`);
        await queryRunner.query(`DROP TABLE "activity_context"`);
		}
}
