export class AddUserRejectQuotes1739671777344 {
	name = 'AddUserRejectQuotes1739671777344'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user" ADD "rejectQuotes" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "rejectQuotes"`);
	}
}
