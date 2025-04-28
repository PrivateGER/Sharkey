/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AntennaGlobalRelay1745849535858 {
    name = 'AntennaGlobalRelay1745849535858'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "antenna" ADD "useGlobalRelay" boolean NOT NULL DEFAULT false`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "antenna" DROP COLUMN "useGlobalRelay"`);
    }
}