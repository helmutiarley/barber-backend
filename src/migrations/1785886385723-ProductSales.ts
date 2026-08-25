import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductSales1785886385723 implements MigrationInterface {
  name = 'ProductSales1785886385723';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "product_sales" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "quantity" integer NOT NULL, "unit_price" numeric(10,2) NOT NULL, "total" numeric(10,2) NOT NULL, "sold_by_barber_id" uuid, "client_id" uuid, "payment_id" uuid NOT NULL, "voided_at" TIMESTAMP WITH TIME ZONE, "voided_by" uuid, "void_reason" character varying, "created_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_product_sales_total_positive" CHECK ("total" > 0), CONSTRAINT "chk_product_sales_unit_price_positive" CHECK ("unit_price" > 0), CONSTRAINT "chk_product_sales_quantity_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_2c87118be8bace114dfdcae1a3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_product_sales_barber_created" ON "product_sales" ("sold_by_barber_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_product_sales_created_at" ON "product_sales" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_product_sales_payment" ON "product_sales" ("payment_id") `,
    );
    await queryRunner.query(`ALTER TABLE "commission_entries" ADD "product_sale_id" uuid`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_commission_entries_product_sale" ON "commission_entries" ("product_sale_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_entries" ADD CONSTRAINT "chk_commission_entries_one_source" CHECK (("appointment_id" IS NULL) <> ("product_sale_id" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" ADD CONSTRAINT "FK_ad4342c12597304e17db2e2c5a9" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" ADD CONSTRAINT "FK_5f856caac9b317c263b835d4a77" FOREIGN KEY ("sold_by_barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" ADD CONSTRAINT "FK_664a518220663d55afdc0feab52" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" ADD CONSTRAINT "FK_639563ba887187b7a09d7b05f2c" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" ADD CONSTRAINT "FK_59e3d61655d1e4c4625ad0e6576" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" ADD CONSTRAINT "FK_db3a98d5e9d1d023ee0cac4c2a6" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_entries" ADD CONSTRAINT "FK_5741b7df4157e5d8dda1c377fe6" FOREIGN KEY ("product_sale_id") REFERENCES "product_sales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commission_entries" DROP CONSTRAINT "FK_5741b7df4157e5d8dda1c377fe6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" DROP CONSTRAINT "FK_db3a98d5e9d1d023ee0cac4c2a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" DROP CONSTRAINT "FK_59e3d61655d1e4c4625ad0e6576"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" DROP CONSTRAINT "FK_639563ba887187b7a09d7b05f2c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" DROP CONSTRAINT "FK_664a518220663d55afdc0feab52"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" DROP CONSTRAINT "FK_5f856caac9b317c263b835d4a77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_sales" DROP CONSTRAINT "FK_ad4342c12597304e17db2e2c5a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_entries" DROP CONSTRAINT "chk_commission_entries_one_source"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_commission_entries_product_sale"`);
    await queryRunner.query(`ALTER TABLE "commission_entries" DROP COLUMN "product_sale_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_product_sales_payment"`);
    await queryRunner.query(`DROP INDEX "public"."idx_product_sales_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_product_sales_barber_created"`);
    await queryRunner.query(`DROP TABLE "product_sales"`);
  }
}
