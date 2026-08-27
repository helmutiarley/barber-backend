import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CashMovementMethod1787900000000 implements MigrationInterface {
  name = 'CashMovementMethod1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD COLUMN "method" "payment_method" NOT NULL DEFAULT 'cash'`,
    );
    await queryRunner.query(
      `UPDATE "cash_movements" AS m SET "method" = p."method" FROM "payments" AS p WHERE m."payment_id" = p."id"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cash_movements_method" ON "cash_movements" ("session_id", "method")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_cash_movements_method"`);
    await queryRunner.query(
      `DELETE FROM "cash_movements" WHERE "method" <> 'cash'`,
    );
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP COLUMN "method"`);
  }
}
