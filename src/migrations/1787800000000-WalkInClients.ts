import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WalkInClients1787800000000 implements MigrationInterface {
  name = 'WalkInClients1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users" SET "email" = concat('walk-in-', "id", '@invalid.local') WHERE "email" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL`);
  }
}
