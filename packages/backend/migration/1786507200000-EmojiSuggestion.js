/*
 * SPDX-FileCopyrightText: Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
export class EmojiSuggestion1786507200000 {
	name = 'EmojiSuggestion1786507200000'

	/**
	 * @param {QueryRunner} queryRunner
	 */
	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "emoji_suggestion" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "fileId" character varying(32) NOT NULL, "name" character varying(128) NOT NULL, "category" character varying(128), "aliases" character varying(128) array NOT NULL DEFAULT '{}', "license" character varying(1024), "localOnly" boolean NOT NULL DEFAULT false, "isSensitive" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_emoji_suggestion" PRIMARY KEY ("id"), CONSTRAINT "FK_emoji_suggestion_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_emoji_suggestion_file" FOREIGN KEY ("fileId") REFERENCES "drive_file"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
		await queryRunner.query(`CREATE INDEX "IDX_emoji_suggestion_user" ON "emoji_suggestion" ("userId")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_emoji_suggestion_file" ON "emoji_suggestion" ("fileId")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_emoji_suggestion_name" ON "emoji_suggestion" ("name")`);
	}

	/**
	 * @param {QueryRunner} queryRunner
	 */
	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE "emoji_suggestion"`);
	}
}
