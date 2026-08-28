import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CashMovementDiscount1788000000000 implements MigrationInterface {
  name = 'CashMovementDiscount1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD COLUMN "discount_amount" numeric(10,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "cash_movements" ADD COLUMN "discount_reason" varchar`);
    await queryRunner.query(
      `ALTER TABLE "cash_movements" DROP CONSTRAINT "chk_cash_movements_amount_positive"`,
    );
    await queryRunner.query(
      `UPDATE "cash_movements" AS m SET "amount" = p."net_amount", "discount_amount" = p."card_fee", "discount_reason" = CASE WHEN p."card_fee" > 0 THEN 'card_processing_fee' ELSE NULL END FROM "payments" AS p WHERE m."payment_id" = p."id" AND m."source" = 'payment' AND m."type" = 'in'`,
    );
    await queryRunner.query(
      `UPDATE "cash_movements" AS m SET "amount" = p."net_amount", "discount_amount" = p."card_fee", "discount_reason" = CASE WHEN p."card_fee" > 0 THEN 'card_processing_fee' ELSE NULL END FROM "payments" AS p WHERE m."payment_id" = p."id" AND m."source" = 'payment' AND m."type" = 'out'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD CONSTRAINT "chk_cash_movements_value_positive" CHECK ("amount" > 0 OR "discount_amount" > 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD CONSTRAINT "chk_cash_movements_discount_non_negative" CHECK ("discount_amount" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD CONSTRAINT "chk_cash_movements_discount_reason" CHECK (("discount_amount" = 0 AND "discount_reason" IS NULL) OR ("discount_amount" > 0 AND "discount_reason" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cash_movements" DROP CONSTRAINT "chk_cash_movements_discount_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" DROP CONSTRAINT "chk_cash_movements_discount_non_negative"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" DROP CONSTRAINT "chk_cash_movements_value_positive"`,
    );
    await queryRunner.query(
      `UPDATE "cash_movements" AS m SET "amount" = p."amount" FROM "payments" AS p WHERE m."payment_id" = p."id" AND m."source" = 'payment'`,
    );
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP COLUMN "discount_reason"`);
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP COLUMN "discount_amount"`);
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD CONSTRAINT "chk_cash_movements_amount_positive" CHECK ("amount" > 0)`,
    );
  }
}
