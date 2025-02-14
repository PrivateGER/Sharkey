export class AddUserProfileDefaultCw1738446745738 {
	name = 'AddUserProfileDefaultCw1738446745738'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_profile" ADD "default_cw" text`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "default_cw"`);
	}
}
