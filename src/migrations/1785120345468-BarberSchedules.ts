import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BarberSchedules1785120345468 implements MigrationInterface {
  name = 'BarberSchedules1785120345468';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "barber_blocks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "barber_id" uuid NOT NULL, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "reason" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a75b1e336daa22289fa0b3c3f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_barber_blocks_barber_starts_at" ON "barber_blocks" ("barber_id", "starts_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "barber_schedules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "barber_id" uuid NOT NULL, "weekday" smallint NOT NULL, "start_time" TIME NOT NULL, "end_time" TIME NOT NULL, "break_start" TIME, "break_end" TIME, CONSTRAINT "PK_4627b44bba87dc720df6eb21eae" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_barber_schedules_barber_weekday" ON "barber_schedules" ("barber_id", "weekday") `,
    );
    await queryRunner.query(
      `ALTER TABLE "barber_blocks" ADD CONSTRAINT "FK_35f8f7dab8f5c3f615808c3219d" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "barber_schedules" ADD CONSTRAINT "FK_abe0e79287b260fa7b03d3696a2" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "barber_schedules" ADD CONSTRAINT "chk_barber_schedules_weekday" CHECK ("weekday" BETWEEN 0 AND 6)`,
    );
    await queryRunner.query(
      `ALTER TABLE "barber_schedules" ADD CONSTRAINT "chk_barber_schedules_window" CHECK ("end_time" > "start_time")`,
    );
    await queryRunner.query(
      `ALTER TABLE "barber_schedules" ADD CONSTRAINT "chk_barber_schedules_break" CHECK (
        ("break_start" IS NULL AND "break_end" IS NULL)
        OR (
          "break_start" IS NOT NULL AND "break_end" IS NOT NULL
          AND "break_end" > "break_start"
          AND "break_start" >= "start_time"
          AND "break_end" <= "end_time"
        )
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "barber_blocks" ADD CONSTRAINT "chk_barber_blocks_range" CHECK ("ends_at" > "starts_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "barber_schedules" DROP CONSTRAINT "FK_abe0e79287b260fa7b03d3696a2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "barber_blocks" DROP CONSTRAINT "FK_35f8f7dab8f5c3f615808c3219d"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_barber_schedules_barber_weekday"`);
    await queryRunner.query(`DROP TABLE "barber_schedules"`);
    await queryRunner.query(`DROP INDEX "public"."idx_barber_blocks_barber_starts_at"`);
    await queryRunner.query(`DROP TABLE "barber_blocks"`);
  }
}
