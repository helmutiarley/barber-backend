import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT_TABLES = [
  'barbers',
  'barber_schedules',
  'barber_blocks',
  'services',
  'appointments',
  'client_profiles',
  'cash_register_sessions',
  'cash_movements',
  'payments',
  'expenses',
  'commission_rules',
  'commission_periods',
  'commission_entries',
  'commission_advances',
  'products',
  'stock_adjustments',
  'product_sales',
];

const ALL_TABLES = ['users', ...TENANT_TABLES];

export class MultiTenantShops1787620000000 implements MigrationInterface {
  name = 'MultiTenantShops1787620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`);

    await queryRunner.query(
      `CREATE TABLE "shops" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "slug" character varying NOT NULL, "domain" character varying NOT NULL, "custom_domain" character varying, "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_shops" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_shops_slug" ON "shops" ("slug")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_shops_domain" ON "shops" ("domain")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_shops_custom_domain" ON "shops" ("custom_domain")`,
    );

    const counts: { count: string }[] = await queryRunner.query(
      `SELECT (${ALL_TABLES.map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(' + ')})::text AS count`,
    );
    const hasExistingData = Number(counts[0].count) > 0;

    let defaultShopId: string | null = null;
    if (hasExistingData) {
      const defaultDomain = process.env.DEFAULT_SHOP_DOMAIN?.trim() || 'default.localhost';
      const inserted: { id: string }[] = await queryRunner.query(
        `INSERT INTO "shops" ("name", "slug", "domain") VALUES ($1, $2, $3) RETURNING "id"`,
        ['Barbearia', 'default', defaultDomain],
      );
      defaultShopId = inserted[0].id;
    }

    for (const table of ALL_TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD "shop_id" uuid`);
      if (defaultShopId) {
        await queryRunner.query(`UPDATE "${table}" SET "shop_id" = $1`, [defaultShopId]);
      }
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "fk_${table}_shop_id" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
      );
    }

    for (const table of TENANT_TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "shop_id" SET NOT NULL`);
    }

    await queryRunner.query(`CREATE INDEX "idx_users_shop_id" ON "users" ("shop_id")`);
    await queryRunner.query(`CREATE INDEX "idx_barbers_shop_id" ON "barbers" ("shop_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_barber_schedules_shop_id" ON "barber_schedules" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_barber_blocks_shop_id" ON "barber_blocks" ("shop_id")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_services_shop_id" ON "services" ("shop_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_shop_id" ON "appointments" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_client_profiles_shop_id" ON "client_profiles" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cash_sessions_shop_id" ON "cash_register_sessions" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cash_movements_shop_id" ON "cash_movements" ("shop_id")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_payments_shop_id" ON "payments" ("shop_id")`);
    await queryRunner.query(`CREATE INDEX "idx_expenses_shop_id" ON "expenses" ("shop_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_commission_rules_shop_id" ON "commission_rules" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_commission_periods_shop_id" ON "commission_periods" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_commission_entries_shop_id" ON "commission_entries" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_commission_advances_shop_id" ON "commission_advances" ("shop_id")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_products_shop_id" ON "products" ("shop_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_stock_adjustments_shop_id" ON "stock_adjustments" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_product_sales_shop_id" ON "product_sales" ("shop_id")`,
    );

    await queryRunner.query(`DROP INDEX "public"."uq_users_email"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_shop_email" ON "users" ("shop_id", "email")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_platform_email" ON "users" ("email") WHERE "shop_id" IS NULL`,
    );

    await queryRunner.query(`DROP INDEX "public"."uq_products_name_active"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_products_name_active" ON "products" ("shop_id", "name") WHERE active`,
    );

    await queryRunner.query(`DROP INDEX "public"."uq_cash_sessions_one_open"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cash_sessions_one_open" ON "cash_register_sessions" ("shop_id", "status") WHERE status = 'open'`,
    );

    await queryRunner.query(`DROP INDEX "public"."uq_commission_rules_scope"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_commission_rules_scope" ON "commission_rules" ("shop_id", "barber_id", "service_id", "applies_to") NULLS NOT DISTINCT WHERE active`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_commission_rules_scope"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_commission_rules_scope" ON "commission_rules" ("barber_id", "service_id", "applies_to") NULLS NOT DISTINCT WHERE active`,
    );

    await queryRunner.query(`DROP INDEX "public"."uq_cash_sessions_one_open"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cash_sessions_one_open" ON "cash_register_sessions" ("status") WHERE status = 'open'`,
    );

    await queryRunner.query(`DROP INDEX "public"."uq_products_name_active"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_products_name_active" ON "products" ("name") WHERE active`,
    );

    await queryRunner.query(`DROP INDEX "public"."uq_users_platform_email"`);
    await queryRunner.query(`DROP INDEX "public"."uq_users_shop_email"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")`);

    for (const table of [...ALL_TABLES].reverse()) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "fk_${table}_shop_id"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "shop_id"`);
    }

    await queryRunner.query(`DROP INDEX "public"."uq_shops_custom_domain"`);
    await queryRunner.query(`DROP INDEX "public"."uq_shops_domain"`);
    await queryRunner.query(`DROP INDEX "public"."uq_shops_slug"`);
    await queryRunner.query(`DROP TABLE "shops"`);
  }
}
