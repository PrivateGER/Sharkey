export class AddUserProfileDefaultCwPriority1738468079662 {
	name = 'AddUserProfileDefaultCwPriority1738468079662'

	async up(queryRunner) {
		await queryRunner.query(`CREATE TYPE "public"."user_profile_default_cw_priority_enum" AS ENUM ('default', 'parent', 'defaultParent', 'parentDefault')`);
		await queryRunner.query(`ALTER TABLE "user_profile" ADD "default_cw_priority" "public"."user_profile_default_cw_priority_enum" NOT NULL DEFAULT 'parent'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "default_cw_priority"`);
		await queryRunner.query(`DROP TYPE "public"."user_profile_default_cw_priority_enum"`);
	}
}
