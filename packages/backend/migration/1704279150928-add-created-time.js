export class AddCreatedTime1704279150928 {
		constructor() {
			this.name = 'AddCreatedTime1704279150928';
		}

    async up(queryRunner) {
		await queryRunner.query(`
			CREATE OR REPLACE FUNCTION public.base36_decode(IN base36 varchar) RETURNS bigint AS $$
			DECLARE
				a char[];
				ret bigint;
				i int;
				val int;
				chars varchar;
			BEGIN
				chars := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
				FOR i IN REVERSE char_length(base36)..1 LOOP
						a := a || substring(upper(base36) FROM i FOR 1)::char;
					END LOOP;
				i := 0;
				ret := 0;
				WHILE i < (array_length(a,1)) LOOP
						val := position(a[i+1] IN chars)-1;
						ret := ret + (val * (36 ^ i));
						i := i + 1;
					END LOOP;

				RAISE NOTICE 'base36_decode(%): %', base36, ret;

				RETURN ret;
			END;
			$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;
		`);

		await queryRunner.query(`
			CREATE OR REPLACE FUNCTION public.parseAId(id varchar)
				RETURNS timestamp AS
			$$
			DECLARE
				cutTimestamp varchar;
			BEGIN
				-- Conversion to timestamp (first eight characters)
				cutTimestamp := substring(id FROM 1 FOR 8);

				RETURN to_timestamp((public.base36_decode(cutTimestamp) + 946684800000) / 1000);
			END;
			$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;
		`);

		await queryRunner.query(`
			CREATE OR REPLACE FUNCTION public.parseMeid(id varchar)
			RETURNS timestamp AS
			$$
			BEGIN
					RETURN to_timestamp(('x' || substring(id from 1 for 12))::bit(48)::bigint - x'800000000000'::bigint);
			END;
			$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;
		`);

		 await queryRunner.query(`
			CREATE OR REPLACE FUNCTION public.parse(id varchar)
			RETURNS timestamp AS
			$$
			BEGIN
				-- Check for aid (length 10, first 8 characters are base36)
				IF length(id) = 10 AND substring(id from 1 for 8) ~* '^[0-9A-Z]{8}$' THEN
					RETURN public.parseAId(id);
				-- Check for aidx (16 base36 characters)
				ELSIF length(id) = 16 AND id ~* '^[0-9A-Z]{16}$' THEN
					RETURN public.parseAId(id);
				-- Check for meid (24 hexadecimal characters)
				ELSIF length(id) = 24 AND id ~* '^[0-9A-F]{24}$' THEN
					RETURN public.parseMeid(id);
				ELSE
					RAISE EXCEPTION 'unrecognized id format: %', id;
				END IF;
			END;
			$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;
		`)

		await queryRunner.query(`
				ALTER TABLE "note" ADD "created_at" timestamp GENERATED ALWAYS AS (public.parse(id)) STORED;
		`);

		await queryRunner.query(`
				CREATE INDEX "IDX_post_time_order" ON "note" ("created_at");
		`);
    }

    async down(queryRunner) {
			await queryRunner.query(`DROP INDEX "IDX_post_time_order"`);
			await queryRunner.query(`ALTER TABLE "note" DROP COLUMN "created_at"`);

			await queryRunner.query(`DROP FUNCTION public.parseAId`);
			await queryRunner.query(`DROP FUNCTION public.parseMeid`);
			await queryRunner.query(`DROP FUNCTION public.parse`);
			await queryRunner.query(`DROP FUNCTION public.base36_decode`);
    }
}
