export class AddNoteProcessErrors1739671352784 {
	name = 'AddNoteProcessErrors1739671352784'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "note" ADD "processErrors" text array`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "note" DROP COLUMN "processErrors"`);
	}
}
