import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ShopSoftDelete1787710000000 implements MigrationInterface {
  name = 'ShopSoftDelete1787710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shops" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`DROP INDEX "public"."uq_shops_slug"`);
    await queryRunner.query(`DROP INDEX "public"."uq_shops_domain"`);
    await queryRunner.query(`DROP INDEX "public"."uq_shops_custom_domain"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_shops_slug" ON "shops" ("slug") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_shops_domain" ON "shops" ("domain") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_shops_custom_domain" ON "shops" ("custom_domain") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_shops_custom_domain"`);
    await queryRunner.query(`DROP INDEX "public"."uq_shops_domain"`);
    await queryRunner.query(`DROP INDEX "public"."uq_shops_slug"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_shops_slug" ON "shops" ("slug")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_shops_domain" ON "shops" ("domain")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_shops_custom_domain" ON "shops" ("custom_domain")`,
    );
    await queryRunner.query(`ALTER TABLE "shops" DROP COLUMN "deleted_at"`);
  }
}
