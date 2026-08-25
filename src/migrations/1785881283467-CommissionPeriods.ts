import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommissionPeriods1785881283467 implements MigrationInterface {
  name = 'CommissionPeriods1785881283467';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "commission_periods" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "barber_id" uuid NOT NULL, "starts_on" date NOT NULL, "ends_on" date NOT NULL, "status" character varying NOT NULL DEFAULT 'closed', "total_entries" numeric(10,2) NOT NULL, "total_advances" numeric(10,2) NOT NULL, "total_due" numeric(10,2) NOT NULL, "closed_by" uuid NOT NULL, "closed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "paid_at" TIMESTAMP WITH TIME ZONE, "payment_method" "public"."payment_method", "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_commission_periods_range" CHECK ("ends_on" >= "starts_on"), CONSTRAINT "PK_c574aba0130569c6589daaca114" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_commission_periods_barber_ends" ON "commission_periods" ("barber_id", "ends_on") `,
    );
    await queryRunner.query(
      `CREATE TABLE "commission_advances" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "barber_id" uuid NOT NULL, "amount" numeric(10,2) NOT NULL, "period_id" uuid, "notes" character varying, "created_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_commission_advances_amount_positive" CHECK ("amount" > 0), CONSTRAINT "PK_9d987129ad433ccf73bb656a95f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_commission_advances_barber_created" ON "commission_advances" ("barber_id", "created_at") `,
    );
    await queryRunner.query(`ALTER TABLE "cash_movements" ADD "advance_id" uuid`);
    await queryRunner.query(`ALTER TABLE "cash_movements" ADD "period_id" uuid`);
    await queryRunner.query(`ALTER TABLE "commission_entries" ADD "period_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "commission_periods" ADD CONSTRAINT "FK_ef985b0bca0c2bd9526db2aa440" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_periods" ADD CONSTRAINT "FK_26ceebbc8f4121f9c91431d9ca1" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_advances" ADD CONSTRAINT "FK_dc03cb934f4079e54591ea0cfea" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_advances" ADD CONSTRAINT "FK_d5ca019c76cf9f0f7e2d2922f49" FOREIGN KEY ("period_id") REFERENCES "commission_periods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_advances" ADD CONSTRAINT "FK_fb06c648cf4a0098b73ad43cf57" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_8aa20f918ad73c3a05a94af73ff" FOREIGN KEY ("advance_id") REFERENCES "commission_advances"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_d7312fffc175ff7f98aacf8b8eb" FOREIGN KEY ("period_id") REFERENCES "commission_periods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_entries" ADD CONSTRAINT "FK_7c0b89841e44d93314a2ba9d23f" FOREIGN KEY ("period_id") REFERENCES "commission_periods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
            ALTER TABLE "commission_periods"
            ADD CONSTRAINT "commission_periods_no_overlap"
            EXCLUDE USING gist (
              "barber_id" WITH =,
              daterange("starts_on", "ends_on", '[]') WITH &&
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commission_periods" DROP CONSTRAINT "commission_periods_no_overlap"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_entries" DROP CONSTRAINT "FK_7c0b89841e44d93314a2ba9d23f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_d7312fffc175ff7f98aacf8b8eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_8aa20f918ad73c3a05a94af73ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_advances" DROP CONSTRAINT "FK_fb06c648cf4a0098b73ad43cf57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_advances" DROP CONSTRAINT "FK_d5ca019c76cf9f0f7e2d2922f49"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_advances" DROP CONSTRAINT "FK_dc03cb934f4079e54591ea0cfea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_periods" DROP CONSTRAINT "FK_26ceebbc8f4121f9c91431d9ca1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_periods" DROP CONSTRAINT "FK_ef985b0bca0c2bd9526db2aa440"`,
    );
    await queryRunner.query(`ALTER TABLE "commission_entries" DROP COLUMN "period_id"`);
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP COLUMN "period_id"`);
    await queryRunner.query(`ALTER TABLE "cash_movements" DROP COLUMN "advance_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_commission_advances_barber_created"`);
    await queryRunner.query(`DROP TABLE "commission_advances"`);
    await queryRunner.query(`DROP INDEX "public"."idx_commission_periods_barber_ends"`);
    await queryRunner.query(`DROP TABLE "commission_periods"`);
  }
}
