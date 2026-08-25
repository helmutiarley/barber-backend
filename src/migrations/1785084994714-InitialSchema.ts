import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1785084994714 implements MigrationInterface {
  name = 'InitialSchema1785084994714';

  public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'MANAGER', 'BARBER', 'CLIENT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "email" character varying NOT NULL, "phone" character varying, "password_hash" character varying, "role" "public"."user_role" NOT NULL, "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email") `);
    await queryRunner.query(
      `CREATE TABLE "services" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "description" text, "price" numeric(10,2) NOT NULL, "duration_minutes" smallint NOT NULL, "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ba2d347a3168a296416c6c5ccb2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "barbers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "display_name" character varying NOT NULL, "photo_url" character varying, "specialties" text array NOT NULL DEFAULT '{}', "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3602c05627856e4cd6d91585d65" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_barbers_user_id" ON "barbers" ("user_id") `);
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')`,
    );
    await queryRunner.query(
      `CREATE TABLE "appointments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "client_id" uuid NOT NULL, "barber_id" uuid NOT NULL, "service_id" uuid NOT NULL, "status" "public"."appointment_status" NOT NULL DEFAULT 'scheduled', "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "price" numeric(10,2) NOT NULL, "duration_minutes" smallint NOT NULL, "notes" text, "cancelled_reason" character varying, "cancelled_by" uuid, "created_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4a437a9a27e948726b8bb3e36ad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_client_starts_at" ON "appointments" ("client_id", "starts_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_barber_starts_at" ON "appointments" ("barber_id", "starts_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "barbers" ADD CONSTRAINT "FK_51d5f4523f06d92e18da7d97506" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_ccc5bbce58ad6bc96faa428b1e4" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_28d5a251a0d69e60f83044f5a55" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_2a2088e8eaa8f28d8de2bdbb857" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_2a2088e8eaa8f28d8de2bdbb857"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_28d5a251a0d69e60f83044f5a55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT "FK_ccc5bbce58ad6bc96faa428b1e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "barbers" DROP CONSTRAINT "FK_51d5f4523f06d92e18da7d97506"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_appointments_barber_starts_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_appointments_client_starts_at"`);
    await queryRunner.query(`DROP TABLE "appointments"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_status"`);
    await queryRunner.query(`DROP INDEX "public"."uq_barbers_user_id"`);
    await queryRunner.query(`DROP TABLE "barbers"`);
    await queryRunner.query(`DROP TABLE "services"`);
    await queryRunner.query(`DROP INDEX "public"."uq_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."user_role"`);
  }
}
