export class AlterUserHideOnlineStatusDefaultTrue1733754069260 {
    name = 'AlterUserHideOnlineStatusDefaultTrue1733754069260'

    async up(queryRunner) {
			await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "hideOnlineStatus" SET DEFAULT true`);
		}

    async down(queryRunner) {
				await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "hideOnlineStatus" SET DEFAULT false`);
		}
}
