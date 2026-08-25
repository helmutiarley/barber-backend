import { MigrationInterface, QueryRunner } from 'typeorm';

export class Commissions1785815989527 implements MigrationInterface {
  name = 'Commissions1785815989527';

  public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`CREATE TYPE "public"."commission_base" AS ENUM('gross', 'net')`);
    await queryRunner.query(
      `CREATE TABLE "commission_rules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "barber_id" uuid, "service_id" uuid, "rate" numeric(5,4) NOT NULL, "base" "public"."commission_base" NOT NULL, "applies_to" character varying NOT NULL DEFAULT 'services', "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_commission_rules_rate_range" CHECK ("rate" >= 0 AND "rate" <= 1), CONSTRAINT "PK_399c9fa57f7fd28dfc57acea3bd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_commission_rules_lookup" ON "commission_rules" ("applies_to", "barber_id", "service_id") `,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_commission_rules_scope" ON "commission_rules" ("barber_id", "service_id", "applies_to") NULLS NOT DISTINCT WHERE "active"`,
    );
    await queryRunner.query(
      `CREATE TABLE "commission_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "barber_id" uuid NOT NULL, "appointment_id" uuid, "rule_id" uuid NOT NULL, "rate" numeric(5,4) NOT NULL, "base" "public"."commission_base" NOT NULL, "base_amount" numeric(10,2) NOT NULL, "amount" numeric(10,2) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_commission_entries_amount_non_negative" CHECK ("amount" >= 0), CONSTRAINT "PK_35b5372834c1af9e381d1bd2f97" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_commission_entries_appointment" ON "commission_entries" ("appointment_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_commission_entries_barber_created" ON "commission_entries" ("barber_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_rules" ADD CONSTRAINT "FK_eb2724bb246d01bd98c3fefca98" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_rules" ADD CONSTRAINT "FK_8d682b931fd4a0d34866265c1f8" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_entries" ADD CONSTRAINT "FK_2d8608e8abace80a8d783b25e02" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_entries" ADD CONSTRAINT "FK_60c43e00349db6aa373ba8d05c6" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_entries" ADD CONSTRAINT "FK_f15c25674034cc027ab2b916ce0" FOREIGN KEY ("rule_id") REFERENCES "commission_rules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commission_entries" DROP CONSTRAINT "FK_f15c25674034cc027ab2b916ce0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_entries" DROP CONSTRAINT "FK_60c43e00349db6aa373ba8d05c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_entries" DROP CONSTRAINT "FK_2d8608e8abace80a8d783b25e02"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_rules" DROP CONSTRAINT "FK_8d682b931fd4a0d34866265c1f8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_rules" DROP CONSTRAINT "FK_eb2724bb246d01bd98c3fefca98"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_commission_entries_barber_created"`);
    await queryRunner.query(`DROP INDEX "public"."uq_commission_entries_appointment"`);
    await queryRunner.query(`DROP TABLE "commission_entries"`);
    await queryRunner.query(`DROP INDEX "public"."uq_commission_rules_scope"`);
    await queryRunner.query(`DROP INDEX "public"."idx_commission_rules_lookup"`);
    await queryRunner.query(`DROP TABLE "commission_rules"`);
    await queryRunner.query(`DROP TYPE "public"."commission_base"`);
  }
}
