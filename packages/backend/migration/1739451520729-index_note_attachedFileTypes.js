// https://stackoverflow.com/a/4059785
export class IndexNoteAttachedFileTypes1739451520729 {
	name = 'IndexNoteAttachedFileTypes1739451520729'

	async up(queryRunner) {
		await queryRunner.query(`CREATE INDEX "IDX_NOTE_ATTACHED_FILE_TYPES" ON "note" USING GIN ("attachedFileTypes" array_ops)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "IDX_NOTE_ATTACHED_FILE_TYPES"`);
	}
}
