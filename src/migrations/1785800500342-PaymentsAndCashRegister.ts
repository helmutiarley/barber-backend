import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentsAndCashRegister1785800500342 implements MigrationInterface {
  name = 'PaymentsAndCashRegister1785800500342';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."cash_session_status" AS ENUM('open', 'closed')`);
    await queryRunner.query(
      `CREATE TABLE "cash_register_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "status" "public"."cash_session_status" NOT NULL DEFAULT 'open', "opened_by" uuid NOT NULL, "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL, "opening_balance" numeric(10,2) NOT NULL, "closed_by" uuid, "closed_at" TIMESTAMP WITH TIME ZONE, "expected_balance" numeric(10,2), "counted_balance" numeric(10,2), "difference" numeric(10,2), "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a852ffb1595560317cd41a2dcf5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cash_sessions_one_open" ON "cash_register_sessions" ("status") WHERE status = 'open'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payment_method" AS ENUM('cash', 'pix', 'debit', 'credit')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "appointment_id" uuid, "amount" numeric(10,2) NOT NULL, "method" "public"."payment_method" NOT NULL, "card_fee" numeric(10,2) NOT NULL DEFAULT '0', "net_amount" numeric(10,2) NOT NULL, "cash_register_session_id" uuid, "received_by" uuid NOT NULL, "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL, "voided_at" TIMESTAMP WITH TIME ZONE, "voided_by" uuid, "void_reason" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_payments_card_fee_non_negative" CHECK ("card_fee" >= 0), CONSTRAINT "chk_payments_amount_positive" CHECK ("amount" > 0), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payments_session_id" ON "payments" ("cash_register_session_id") `,
    );
    await queryRunner.query(`CREATE INDEX "idx_payments_paid_at" ON "payments" ("paid_at") `);
    await queryRunner.query(
      `CREATE INDEX "idx_payments_appointment_id" ON "payments" ("appointment_id") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."cash_movement_type" AS ENUM('in', 'out')`);
    await queryRunner.query(
      `CREATE TABLE "cash_movements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "session_id" uuid NOT NULL, "type" "public"."cash_movement_type" NOT NULL, "source" character varying NOT NULL, "amount" numeric(10,2) NOT NULL, "payment_id" uuid, "description" character varying, "created_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_cash_movements_amount_positive" CHECK ("amount" > 0), CONSTRAINT "PK_25faead19e1ff74153a01604d37" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cash_movements_session_id" ON "cash_movements" ("session_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_register_sessions" ADD CONSTRAINT "FK_d8dd78fcd926acb33c0a4205fe7" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_register_sessions" ADD CONSTRAINT "FK_c5bfb1bea3d9094f87cfe62fe2e" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_9f49987820da519f855d04c82bd" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_d4e6842e33233b535d58f627dc7" FOREIGN KEY ("cash_register_session_id") REFERENCES "cash_register_sessions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_addd19c06574aa904472b8c82bd" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_98dcd5dbcd88233a0e8dbf7a49a" FOREIGN KEY ("session_id") REFERENCES "cash_register_sessions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_173e062abe14fd8708e8246d40c" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" ADD CONSTRAINT "FK_3e189155db57fc4ec067ef68aa5" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_3e189155db57fc4ec067ef68aa5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_173e062abe14fd8708e8246d40c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_movements" DROP CONSTRAINT "FK_98dcd5dbcd88233a0e8dbf7a49a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_addd19c06574aa904472b8c82bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_d4e6842e33233b535d58f627dc7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_9f49987820da519f855d04c82bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_register_sessions" DROP CONSTRAINT "FK_c5bfb1bea3d9094f87cfe62fe2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_register_sessions" DROP CONSTRAINT "FK_d8dd78fcd926acb33c0a4205fe7"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_cash_movements_session_id"`);
    await queryRunner.query(`DROP TABLE "cash_movements"`);
    await queryRunner.query(`DROP TYPE "public"."cash_movement_type"`);
    await queryRunner.query(`DROP INDEX "public"."idx_payments_appointment_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_payments_paid_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_payments_session_id"`);
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TYPE "public"."payment_method"`);
    await queryRunner.query(`DROP INDEX "public"."uq_cash_sessions_one_open"`);
    await queryRunner.query(`DROP TABLE "cash_register_sessions"`);
    await queryRunner.query(`DROP TYPE "public"."cash_session_status"`);
  }
}
