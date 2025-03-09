export class AddInstanceRejectQuotes1739671847942 {
	name = 'AddInstanceRejectQuotes1739671847942'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "instance" ADD "rejectQuotes" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "instance" DROP COLUMN "rejectQuotes"`);
	}
}
