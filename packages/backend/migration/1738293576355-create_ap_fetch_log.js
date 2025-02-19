export class CreateApFetchLog1738293576355 {
	name = 'CreateApFetchLog1738293576355'

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "ap_fetch_log" ("id" character varying(32) NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL, "duration" double precision, "host" text NOT NULL, "request_uri" text NOT NULL, "object_uri" text, "accepted" boolean, "result" text, "object" jsonb, "context_hash" text, CONSTRAINT "PK_ap_fetch_log" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE INDEX "IDX_ap_fetch_log_at" ON "ap_fetch_log" ("at") `);
		await queryRunner.query(`CREATE INDEX "IDX_ap_fetch_log_host" ON "ap_fetch_log" ("host") `);
		await queryRunner.query(`CREATE INDEX "IDX_ap_fetch_log_object_uri" ON "ap_fetch_log" ("object_uri") `);
		await queryRunner.query(`ALTER TABLE "ap_fetch_log" ADD CONSTRAINT "FK_ap_fetch_log_context_hash" FOREIGN KEY ("context_hash") REFERENCES "ap_context"("md5") ON DELETE CASCADE ON UPDATE NO ACTION`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "ap_fetch_log" DROP CONSTRAINT "FK_ap_fetch_log_context_hash"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_ap_fetch_log_object_uri"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_ap_fetch_log_host"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_ap_fetch_log_at"`);
		await queryRunner.query(`DROP TABLE "ap_fetch_log"`);
	}
}
