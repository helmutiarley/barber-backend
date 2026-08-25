import { MigrationInterface, QueryRunner } from 'typeorm';

export class AppointmentOverlapConstraint1785085100000 implements MigrationInterface {
  name = 'AppointmentOverlapConstraint1785085100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await queryRunner.query(`
      ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_no_overlap"
      EXCLUDE USING gist (
        "barber_id" WITH =,
        tstzrange("starts_at", "ends_at") WITH &&
      )
      WHERE ("status" IN ('scheduled', 'confirmed'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_overlap"`);
  }
}
