import { MigrationInterface, QueryRunner } from 'typeorm';

export class Expenses1785802638633 implements MigrationInterface {
  name = 'Expenses1785802638633';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "expenses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "description" character varying NOT NULL, "category" character varying NOT NULL, "kind" character varying NOT NULL, "amount" numeric(10,2) NOT NULL, "due_date" date, "paid_at" TIMESTAMP WITH TIME ZONE, "payment_method" "public"."payment_method", "recurring" boolean NOT NULL DEFAULT false, "created_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_expenses_amount_positive" CHECK ("amount" > 0), CONSTRAINT "PK_94c3ceb17e3140abc9282c20610" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_expenses_due_date" ON "expenses" ("due_date") `);
    await queryRunner.query(`CREATE INDEX "idx_expenses_paid_at" ON "expenses" ("paid_at") `);
    await queryRunner.query(`ALTER TABLE "cash_movements" ADD "expense_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "expenses" ADD CONSTRAINT "FK_7c0c012c2f8e6578277c239ee61" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_f3e8e2640912b74a9a11885705f" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_f3e8e2640912b74a9a11885705f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "expenses" DROP CONSTRAINT "FK_7c0c012c2f8e6578277c239ee61"`,
    );
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP COLUMN "expense_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_expenses_paid_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_expenses_due_date"`);
    await queryRunner.query(`DROP TABLE "expenses"`);
  }
}
