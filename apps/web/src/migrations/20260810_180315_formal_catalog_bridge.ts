import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_figure_prototypes_figure_type" ADD VALUE 'static';
  CREATE TABLE "catalog_items_image_refs" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "image_ref_key" varchar NOT NULL,
    "url" varchar NOT NULL,
    "source_family" varchar NOT NULL,
    "catalog_item_key" varchar NOT NULL,
    "is_main" boolean DEFAULT false NOT NULL
  );

  CREATE TABLE "catalog_items" (
    "id" serial PRIMARY KEY NOT NULL,
    "stable_id" varchar NOT NULL,
    "catalog_item_key" varchar NOT NULL,
    "character_id" integer NOT NULL,
    "prototype_id" integer NOT NULL,
    "title" varchar NOT NULL,
    "manufacturer_text" varchar NOT NULL,
    "classification" varchar NOT NULL,
    "category" varchar,
    "scale" varchar,
    "height_mm" numeric,
    "release" varchar,
    "product_type" varchar,
    "series" varchar,
    "description" varchar,
    "lock_version" numeric DEFAULT 1 NOT NULL,
    "created_by_id" integer NOT NULL,
    "updated_by_id" integer NOT NULL,
    "deleted_at" timestamp(3) with time zone,
    "deleted_by_id" integer,
    "delete_reason" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "source_records" (
    "id" serial PRIMARY KEY NOT NULL,
    "stable_id" varchar NOT NULL,
    "source_record_key" varchar NOT NULL,
    "source_family" varchar NOT NULL,
    "source_url" varchar NOT NULL,
    "observed_title" varchar,
    "observed_manufacturer" varchar,
    "source_label" varchar,
    "source_role" varchar,
    "character_id" integer NOT NULL,
    "catalog_item_id" integer NOT NULL,
    "business_digest" varchar NOT NULL,
    "business_digest_version" numeric NOT NULL,
    "lock_version" numeric DEFAULT 1 NOT NULL,
    "created_by_id" integer NOT NULL,
    "updated_by_id" integer NOT NULL,
    "deleted_at" timestamp(3) with time zone,
    "deleted_by_id" integer,
    "delete_reason" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "figure_prototypes" ALTER COLUMN "manufacturer_id" DROP NOT NULL;
  ALTER TABLE "figure_prototypes" ADD COLUMN "projection_key" varchar;
  ALTER TABLE "figure_prototypes" ADD COLUMN "membership_fingerprint" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "catalog_items_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "source_records_id" integer;
  ALTER TABLE "catalog_items_image_refs" ADD CONSTRAINT "catalog_items_image_refs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_prototype_id_figure_prototypes_id_fk" FOREIGN KEY ("prototype_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "catalog_items_image_refs_order_idx" ON "catalog_items_image_refs" USING btree ("_order");
  CREATE INDEX "catalog_items_image_refs_parent_id_idx" ON "catalog_items_image_refs" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "catalog_items_stable_id_idx" ON "catalog_items" USING btree ("stable_id");
  CREATE UNIQUE INDEX "catalog_items_catalog_item_key_idx" ON "catalog_items" USING btree ("catalog_item_key");
  CREATE INDEX "catalog_items_character_idx" ON "catalog_items" USING btree ("character_id");
  CREATE INDEX "catalog_items_prototype_idx" ON "catalog_items" USING btree ("prototype_id");
  CREATE INDEX "catalog_items_created_by_idx" ON "catalog_items" USING btree ("created_by_id");
  CREATE INDEX "catalog_items_updated_by_idx" ON "catalog_items" USING btree ("updated_by_id");
  CREATE INDEX "catalog_items_deleted_by_idx" ON "catalog_items" USING btree ("deleted_by_id");
  CREATE INDEX "catalog_items_updated_at_idx" ON "catalog_items" USING btree ("updated_at");
  CREATE INDEX "catalog_items_created_at_idx" ON "catalog_items" USING btree ("created_at");
  CREATE UNIQUE INDEX "source_records_stable_id_idx" ON "source_records" USING btree ("stable_id");
  CREATE UNIQUE INDEX "source_records_source_record_key_idx" ON "source_records" USING btree ("source_record_key");
  CREATE INDEX "source_records_source_family_idx" ON "source_records" USING btree ("source_family");
  CREATE INDEX "source_records_character_idx" ON "source_records" USING btree ("character_id");
  CREATE INDEX "source_records_catalog_item_idx" ON "source_records" USING btree ("catalog_item_id");
  CREATE INDEX "source_records_created_by_idx" ON "source_records" USING btree ("created_by_id");
  CREATE INDEX "source_records_updated_by_idx" ON "source_records" USING btree ("updated_by_id");
  CREATE INDEX "source_records_deleted_by_idx" ON "source_records" USING btree ("deleted_by_id");
  CREATE INDEX "source_records_updated_at_idx" ON "source_records" USING btree ("updated_at");
  CREATE INDEX "source_records_created_at_idx" ON "source_records" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_catalog_items_fk" FOREIGN KEY ("catalog_items_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_records_fk" FOREIGN KEY ("source_records_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "figure_prototypes_projection_key_idx" ON "figure_prototypes" USING btree ("projection_key");
  CREATE INDEX "payload_locked_documents_rels_catalog_items_id_idx" ON "payload_locked_documents_rels" USING btree ("catalog_items_id");
  CREATE INDEX "payload_locked_documents_rels_source_records_id_idx" ON "payload_locked_documents_rels" USING btree ("source_records_id");

  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_projection_identity_chk" CHECK (("projection_key" IS NULL AND "membership_fingerprint" IS NULL) OR (NULLIF(BTRIM("projection_key"), '') IS NOT NULL AND "membership_fingerprint" ~ '^[0-9a-f]{64}$'));

  ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_stable_id_uuid_chk" CHECK ("stable_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_lock_version_positive_chk" CHECK ("lock_version" > 0);
  ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_required_text_chk" CHECK (NULLIF(BTRIM("catalog_item_key"), '') IS NOT NULL AND NULLIF(BTRIM("title"), '') IS NOT NULL AND NULLIF(BTRIM("manufacturer_text"), '') IS NOT NULL AND NULLIF(BTRIM("classification"), '') IS NOT NULL);
  ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_height_nonnegative_chk" CHECK ("height_mm" IS NULL OR "height_mm" >= 0);
  ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_soft_delete_attribution_chk" CHECK ("deleted_at" IS NULL OR ("deleted_by_id" IS NOT NULL AND NULLIF(BTRIM("delete_reason"), '') IS NOT NULL));

  ALTER TABLE "catalog_items_image_refs" ADD CONSTRAINT "catalog_items_image_refs_required_text_chk" CHECK (NULLIF(BTRIM("image_ref_key"), '') IS NOT NULL AND NULLIF(BTRIM("url"), '') IS NOT NULL AND NULLIF(BTRIM("source_family"), '') IS NOT NULL AND NULLIF(BTRIM("catalog_item_key"), '') IS NOT NULL);

  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_stable_id_uuid_chk" CHECK ("stable_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_lock_version_positive_chk" CHECK ("lock_version" > 0);
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_required_text_chk" CHECK (NULLIF(BTRIM("source_record_key"), '') IS NOT NULL AND NULLIF(BTRIM("source_family"), '') IS NOT NULL AND NULLIF(BTRIM("source_url"), '') IS NOT NULL);
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_business_digest_chk" CHECK ("business_digest" ~ '^[0-9a-f]{64}$' AND "business_digest_version" > 0 AND "business_digest_version" = TRUNC("business_digest_version"));
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_soft_delete_attribution_chk" CHECK ("deleted_at" IS NULL OR ("deleted_by_id" IS NOT NULL AND NULLIF(BTRIM("delete_reason"), '') IS NOT NULL));`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_catalog_items_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_source_records_fk";
  ALTER TABLE "catalog_items_image_refs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "catalog_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "source_records" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "catalog_items_image_refs" CASCADE;
  DROP TABLE "source_records" CASCADE;
  DROP TABLE "catalog_items" CASCADE;

  ALTER TABLE "figure_prototypes" DROP CONSTRAINT "figure_prototypes_projection_identity_chk";
  ALTER TABLE "figure_prototypes" ALTER COLUMN "figure_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_figure_prototypes_figure_type";
  CREATE TYPE "public"."enum_figure_prototypes_figure_type" AS ENUM('scale', 'prize');
  ALTER TABLE "figure_prototypes" ALTER COLUMN "figure_type" SET DATA TYPE "public"."enum_figure_prototypes_figure_type" USING "figure_type"::"public"."enum_figure_prototypes_figure_type";
  DROP INDEX "figure_prototypes_projection_key_idx";
  DROP INDEX "payload_locked_documents_rels_catalog_items_id_idx";
  DROP INDEX "payload_locked_documents_rels_source_records_id_idx";
  ALTER TABLE "figure_prototypes" ALTER COLUMN "manufacturer_id" SET NOT NULL;
  ALTER TABLE "figure_prototypes" DROP COLUMN "projection_key";
  ALTER TABLE "figure_prototypes" DROP COLUMN "membership_fingerprint";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "catalog_items_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "source_records_id";`)
}
