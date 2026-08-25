import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClientProfiles1785796425050 implements MigrationInterface {
  name = 'ClientProfiles1785796425050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "client_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "birthday" date, "preferences" text, "internal_notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fc4acd4b04f4a0537e7213f8ddd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_client_profiles_user_id" ON "client_profiles" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "client_profiles" ADD CONSTRAINT "FK_542bfcd136b7ef76af7e4edf1d7" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_profiles" DROP CONSTRAINT "FK_542bfcd136b7ef76af7e4edf1d7"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_client_profiles_user_id"`);
    await queryRunner.query(`DROP TABLE "client_profiles"`);
  }
}
