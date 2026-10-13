/*
 * SPDX-FileCopyrightText: piuvas and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ListenbrainzKey1775247308851 {
	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" ADD "listenbrainzAuthKey" character varying(1024)`);
	}
	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "listenbrainzAuthKey"`);
	}
}
