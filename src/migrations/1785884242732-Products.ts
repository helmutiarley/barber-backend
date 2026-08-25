import { MigrationInterface, QueryRunner } from 'typeorm';

export class Products1785884242732 implements MigrationInterface {
  name = 'Products1785884242732';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "description" text, "price" numeric(10,2) NOT NULL, "cost" numeric(10,2), "stock_quantity" integer NOT NULL DEFAULT '0', "low_stock_threshold" integer NOT NULL DEFAULT '0', "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_products_price_positive" CHECK ("price" > 0), CONSTRAINT "chk_products_low_stock_threshold_non_negative" CHECK ("low_stock_threshold" >= 0), CONSTRAINT "chk_products_stock_non_negative" CHECK ("stock_quantity" >= 0), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_products_name_active" ON "products" ("name") WHERE active`,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_adjustments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "delta" integer NOT NULL, "reason" character varying NOT NULL, "resulting_quantity" integer NOT NULL, "notes" character varying, "created_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_stock_adjustments_delta_non_zero" CHECK ("delta" <> 0), CONSTRAINT "PK_7dc03d92f242dd489d33b80d063" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_stock_adjustments_product_created" ON "stock_adjustments" ("product_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_adjustments" ADD CONSTRAINT "FK_aec247181f0d73ffe0393013a15" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_adjustments" ADD CONSTRAINT "FK_ffcab531cd75f7559af2f209038" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock_adjustments" DROP CONSTRAINT "FK_ffcab531cd75f7559af2f209038"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_adjustments" DROP CONSTRAINT "FK_aec247181f0d73ffe0393013a15"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_stock_adjustments_product_created"`);
    await queryRunner.query(`DROP TABLE "stock_adjustments"`);
    await queryRunner.query(`DROP INDEX "public"."uq_products_name_active"`);
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
