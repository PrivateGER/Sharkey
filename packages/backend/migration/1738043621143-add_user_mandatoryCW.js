export class AddUserMandatoryCW1738043621143 {
	name = 'AddUserCW1738043621143'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user" ADD "mandatoryCW" text`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "mandatoryCW"`);
	}
}
