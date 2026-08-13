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
export class ProxyRemoteEmojiSuggestion1786632040000 {
	name = 'ProxyRemoteEmojiSuggestion1786632040000';

	/**
	 * @param {QueryRunner} queryRunner
	 */
	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "emoji_suggestion" ALTER COLUMN "fileId" DROP NOT NULL`);
		await queryRunner.query(`ALTER TABLE "emoji_suggestion" ADD "remoteEmojiId" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "emoji_suggestion" ADD "remoteEmojiUrl" character varying(512)`);
		await queryRunner.query(`ALTER TABLE "emoji_suggestion" ADD "remoteEmojiHost" character varying(128)`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_emoji_suggestion_remote_emoji" ON "emoji_suggestion" ("remoteEmojiId")`);
		await queryRunner.query(`ALTER TABLE "emoji_suggestion" ADD CONSTRAINT "CK_emoji_suggestion_source" CHECK (("fileId" IS NOT NULL AND "remoteEmojiId" IS NULL AND "remoteEmojiUrl" IS NULL AND "remoteEmojiHost" IS NULL) OR ("fileId" IS NULL AND "remoteEmojiId" IS NOT NULL AND "remoteEmojiUrl" IS NOT NULL AND "remoteEmojiHost" IS NOT NULL))`);
	}

	/**
	 * @param {QueryRunner} queryRunner
	 */
	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "emoji_suggestion" DROP CONSTRAINT "CK_emoji_suggestion_source"`);
		await queryRunner.query(`DROP INDEX "IDX_emoji_suggestion_remote_emoji"`);
		await queryRunner.query(`DELETE FROM "emoji_suggestion" WHERE "fileId" IS NULL`);
		await queryRunner.query(`ALTER TABLE "emoji_suggestion" DROP COLUMN "remoteEmojiHost"`);
		await queryRunner.query(`ALTER TABLE "emoji_suggestion" DROP COLUMN "remoteEmojiUrl"`);
		await queryRunner.query(`ALTER TABLE "emoji_suggestion" DROP COLUMN "remoteEmojiId"`);
		await queryRunner.query(`ALTER TABLE "emoji_suggestion" ALTER COLUMN "fileId" SET NOT NULL`);
	}
}
