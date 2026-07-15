import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_works_work_type" AS ENUM('animation', 'game', 'comic', 'novel', 'other');
  CREATE TYPE "public"."enum_works_publication_status" AS ENUM('draft', 'published', 'hidden');
  CREATE TYPE "public"."enum_characters_status" AS ENUM('active', 'matching_pending', 'hidden');
  CREATE TYPE "public"."enum_character_aliases_alias_type" AS ENUM('official', 'translation', 'common', 'romanization', 'source_only');
  CREATE TYPE "public"."enum_manufacturers_status" AS ENUM('draft', 'active', 'hidden');
  CREATE TYPE "public"."enum_figure_prototypes_figure_type" AS ENUM('scale', 'prize');
  CREATE TYPE "public"."enum_figure_prototypes_authorization_status" AS ENUM('pending', 'official', 'authorized_third_party', 'rejected');
  CREATE TYPE "public"."enum_figure_prototypes_inclusion_status" AS ENUM('pending', 'eligible', 'excluded');
  CREATE TYPE "public"."enum_figure_prototypes_publication_status" AS ENUM('draft', 'published', 'hidden', 'merged', 'archived');
  CREATE TYPE "public"."enum_figure_prototype_characters_role" AS ENUM('primary', 'secondary', 'companion');
  CREATE TYPE "public"."enum_figure_versions_kind" AS ENUM('regular', 'deluxe', 'reissue', 'bonus', 'recolor', 'channel-exclusive');
  CREATE TYPE "public"."enum_figure_versions_release_status" AS ENUM('announced', 'gray_prototype', 'painted_prototype', 'preorder', 'released', 'cancelled', 'unknown');
  CREATE TYPE "public"."enum_figure_versions_gray_model_completeness" AS ENUM('not_applicable', 'complete', 'partial', 'unknown');
  CREATE TYPE "public"."enum_operation_logs_actor_type" AS ENUM('admin', 'system');
  CREATE TYPE "public"."enum_operation_logs_duty_context" AS ENUM('catalog_maintenance', 'catalog_review');
  CREATE TABLE "works" (
	"id" serial PRIMARY KEY NOT NULL,
	"stable_id" varchar NOT NULL,
	"display_name" varchar NOT NULL,
	"original_name" varchar,
	"normalized_name" varchar NOT NULL,
	"work_type" "enum_works_work_type" DEFAULT 'other' NOT NULL,
	"publication_status" "enum_works_publication_status" DEFAULT 'draft' NOT NULL,
	"lock_version" numeric DEFAULT 1 NOT NULL,
	"created_by_id" integer NOT NULL,
	"updated_by_id" integer NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"deleted_by_id" integer,
	"delete_reason" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"stable_id" varchar NOT NULL,
	"work_id" integer,
	"display_name" varchar NOT NULL,
	"name_zh" varchar,
	"name_ja" varchar,
	"name_en" varchar,
	"normalized_name" varchar NOT NULL,
	"search_document" varchar NOT NULL,
	"status" "enum_characters_status" DEFAULT 'matching_pending' NOT NULL,
	"lock_version" numeric DEFAULT 1 NOT NULL,
	"created_by_id" integer NOT NULL,
	"updated_by_id" integer NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"deleted_by_id" integer,
	"delete_reason" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "character_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"stable_id" varchar NOT NULL,
	"character_id" integer NOT NULL,
	"value" varchar NOT NULL,
	"normalized_value" varchar NOT NULL,
	"locale" varchar,
	"alias_type" "enum_character_aliases_alias_type" DEFAULT 'common' NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"created_by_id" integer NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"deleted_by_id" integer,
	"delete_reason" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "manufacturers_aliases" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"value" varchar NOT NULL,
	"normalized_value" varchar NOT NULL,
	"locale" varchar
  );

  CREATE TABLE "manufacturers" (
	"id" serial PRIMARY KEY NOT NULL,
	"stable_id" varchar NOT NULL,
	"canonical_name" varchar NOT NULL,
	"normalized_name" varchar NOT NULL,
	"official_site_url" varchar,
	"authorization_note" varchar,
	"source_evidence" jsonb,
	"status" "enum_manufacturers_status" DEFAULT 'draft' NOT NULL,
	"lock_version" numeric DEFAULT 1 NOT NULL,
	"created_by_id" integer NOT NULL,
	"updated_by_id" integer NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"deleted_by_id" integer,
	"delete_reason" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "figure_prototypes" (
	"id" serial PRIMARY KEY NOT NULL,
	"stable_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"normalized_title" varchar NOT NULL,
	"work_id" integer,
	"manufacturer_id" integer NOT NULL,
	"figure_type" "enum_figure_prototypes_figure_type" NOT NULL,
	"scale" varchar,
	"costume_text" varchar,
	"is_group" boolean DEFAULT false NOT NULL,
	"adult_entry_flag" boolean DEFAULT false NOT NULL,
	"authorization_status" "enum_figure_prototypes_authorization_status" DEFAULT 'pending' NOT NULL,
	"authorization_evidence" jsonb,
	"authorization_reason" varchar,
	"authorization_reviewed_by_id" integer,
	"authorization_reviewed_at" timestamp(3) with time zone,
	"inclusion_status" "enum_figure_prototypes_inclusion_status" DEFAULT 'pending' NOT NULL,
	"inclusion_reason" varchar,
	"inclusion_reviewed_by_id" integer,
	"inclusion_reviewed_at" timestamp(3) with time zone,
	"publication_status" "enum_figure_prototypes_publication_status" DEFAULT 'draft' NOT NULL,
	"merged_into_id" integer,
	"lock_version" numeric DEFAULT 1 NOT NULL,
	"created_by_id" integer NOT NULL,
	"updated_by_id" integer NOT NULL,
	"archived_at" timestamp(3) with time zone,
	"archived_by_id" integer,
	"archive_reason" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "figure_prototype_characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"stable_id" varchar NOT NULL,
	"prototype_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"display_order" numeric NOT NULL,
	"role" "enum_figure_prototype_characters_role" NOT NULL,
	"created_by_id" integer NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"deleted_by_id" integer,
	"delete_reason" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "figure_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"stable_id" varchar NOT NULL,
	"prototype_id" integer NOT NULL,
	"name" varchar NOT NULL,
	"normalized_version_key" varchar NOT NULL,
	"kind" "enum_figure_versions_kind" NOT NULL,
	"channel_or_distributor_label" varchar,
	"release_status" "enum_figure_versions_release_status" DEFAULT 'unknown' NOT NULL,
	"gray_model_completeness" "enum_figure_versions_gray_model_completeness" DEFAULT 'not_applicable' NOT NULL,
	"release_date" timestamp(3) with time zone,
	"sku_or_code" varchar,
	"notes" varchar,
	"lock_version" numeric DEFAULT 1 NOT NULL,
	"created_by_id" integer NOT NULL,
	"updated_by_id" integer NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"deleted_by_id" integer,
	"delete_reason" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "operation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_id" varchar NOT NULL,
	"actor_user_id" integer,
	"actor_type" "enum_operation_logs_actor_type" NOT NULL,
	"duty_context" "enum_operation_logs_duty_context" NOT NULL,
	"action" varchar NOT NULL,
	"scope_type" varchar NOT NULL,
	"scope_stable_id" varchar NOT NULL,
	"reason" varchar NOT NULL,
	"expected_version" numeric,
	"result_version" numeric NOT NULL,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"request_digest" varchar NOT NULL,
	"reversible" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "works_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "characters_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "character_aliases_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "manufacturers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "figure_prototypes_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "figure_prototype_characters_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "figure_versions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "operation_logs_id" integer;
  ALTER TABLE "works" ADD CONSTRAINT "works_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "works" ADD CONSTRAINT "works_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "works" ADD CONSTRAINT "works_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "characters" ADD CONSTRAINT "characters_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "characters" ADD CONSTRAINT "characters_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "characters" ADD CONSTRAINT "characters_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "characters" ADD CONSTRAINT "characters_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "character_aliases" ADD CONSTRAINT "character_aliases_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "character_aliases" ADD CONSTRAINT "character_aliases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "character_aliases" ADD CONSTRAINT "character_aliases_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "manufacturers_aliases" ADD CONSTRAINT "manufacturers_aliases_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."manufacturers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_authorization_reviewed_by_id_users_id_fk" FOREIGN KEY ("authorization_reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_inclusion_reviewed_by_id_users_id_fk" FOREIGN KEY ("inclusion_reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_merged_into_id_figure_prototypes_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_archived_by_id_users_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototype_characters" ADD CONSTRAINT "figure_prototype_characters_prototype_id_figure_prototypes_id_fk" FOREIGN KEY ("prototype_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "figure_prototype_characters" ADD CONSTRAINT "figure_prototype_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "figure_prototype_characters" ADD CONSTRAINT "figure_prototype_characters_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototype_characters" ADD CONSTRAINT "figure_prototype_characters_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_versions" ADD CONSTRAINT "figure_versions_prototype_id_figure_prototypes_id_fk" FOREIGN KEY ("prototype_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "figure_versions" ADD CONSTRAINT "figure_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_versions" ADD CONSTRAINT "figure_versions_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_versions" ADD CONSTRAINT "figure_versions_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "works_stable_id_idx" ON "works" USING btree ("stable_id");
  CREATE INDEX "works_normalized_name_idx" ON "works" USING btree ("normalized_name");
  CREATE INDEX "works_created_by_idx" ON "works" USING btree ("created_by_id");
  CREATE INDEX "works_updated_by_idx" ON "works" USING btree ("updated_by_id");
  CREATE INDEX "works_deleted_by_idx" ON "works" USING btree ("deleted_by_id");
  CREATE INDEX "works_updated_at_idx" ON "works" USING btree ("updated_at");
  CREATE INDEX "works_created_at_idx" ON "works" USING btree ("created_at");
  CREATE UNIQUE INDEX "characters_stable_id_idx" ON "characters" USING btree ("stable_id");
  CREATE INDEX "characters_work_idx" ON "characters" USING btree ("work_id");
  CREATE INDEX "characters_normalized_name_idx" ON "characters" USING btree ("normalized_name");
  CREATE INDEX "characters_created_by_idx" ON "characters" USING btree ("created_by_id");
  CREATE INDEX "characters_updated_by_idx" ON "characters" USING btree ("updated_by_id");
  CREATE INDEX "characters_deleted_by_idx" ON "characters" USING btree ("deleted_by_id");
  CREATE INDEX "characters_updated_at_idx" ON "characters" USING btree ("updated_at");
  CREATE INDEX "characters_created_at_idx" ON "characters" USING btree ("created_at");
  CREATE UNIQUE INDEX "character_aliases_stable_id_idx" ON "character_aliases" USING btree ("stable_id");
  CREATE INDEX "character_aliases_character_idx" ON "character_aliases" USING btree ("character_id");
  CREATE INDEX "character_aliases_normalized_value_idx" ON "character_aliases" USING btree ("normalized_value");
  CREATE INDEX "character_aliases_created_by_idx" ON "character_aliases" USING btree ("created_by_id");
  CREATE INDEX "character_aliases_deleted_by_idx" ON "character_aliases" USING btree ("deleted_by_id");
  CREATE INDEX "character_aliases_updated_at_idx" ON "character_aliases" USING btree ("updated_at");
  CREATE INDEX "character_aliases_created_at_idx" ON "character_aliases" USING btree ("created_at");
  CREATE INDEX "manufacturers_aliases_order_idx" ON "manufacturers_aliases" USING btree ("_order");
  CREATE INDEX "manufacturers_aliases_parent_id_idx" ON "manufacturers_aliases" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "manufacturers_stable_id_idx" ON "manufacturers" USING btree ("stable_id");
  CREATE INDEX "manufacturers_normalized_name_idx" ON "manufacturers" USING btree ("normalized_name");
  CREATE INDEX "manufacturers_created_by_idx" ON "manufacturers" USING btree ("created_by_id");
  CREATE INDEX "manufacturers_updated_by_idx" ON "manufacturers" USING btree ("updated_by_id");
  CREATE INDEX "manufacturers_deleted_by_idx" ON "manufacturers" USING btree ("deleted_by_id");
  CREATE INDEX "manufacturers_updated_at_idx" ON "manufacturers" USING btree ("updated_at");
  CREATE INDEX "manufacturers_created_at_idx" ON "manufacturers" USING btree ("created_at");
  CREATE UNIQUE INDEX "figure_prototypes_stable_id_idx" ON "figure_prototypes" USING btree ("stable_id");
  CREATE INDEX "figure_prototypes_normalized_title_idx" ON "figure_prototypes" USING btree ("normalized_title");
  CREATE INDEX "figure_prototypes_work_idx" ON "figure_prototypes" USING btree ("work_id");
  CREATE INDEX "figure_prototypes_manufacturer_idx" ON "figure_prototypes" USING btree ("manufacturer_id");
  CREATE INDEX "figure_prototypes_authorization_reviewed_by_idx" ON "figure_prototypes" USING btree ("authorization_reviewed_by_id");
  CREATE INDEX "figure_prototypes_inclusion_reviewed_by_idx" ON "figure_prototypes" USING btree ("inclusion_reviewed_by_id");
  CREATE INDEX "figure_prototypes_merged_into_idx" ON "figure_prototypes" USING btree ("merged_into_id");
  CREATE INDEX "figure_prototypes_created_by_idx" ON "figure_prototypes" USING btree ("created_by_id");
  CREATE INDEX "figure_prototypes_updated_by_idx" ON "figure_prototypes" USING btree ("updated_by_id");
  CREATE INDEX "figure_prototypes_archived_by_idx" ON "figure_prototypes" USING btree ("archived_by_id");
  CREATE INDEX "figure_prototypes_updated_at_idx" ON "figure_prototypes" USING btree ("updated_at");
  CREATE INDEX "figure_prototypes_created_at_idx" ON "figure_prototypes" USING btree ("created_at");
  CREATE UNIQUE INDEX "figure_prototype_characters_stable_id_idx" ON "figure_prototype_characters" USING btree ("stable_id");
  CREATE INDEX "figure_prototype_characters_prototype_idx" ON "figure_prototype_characters" USING btree ("prototype_id");
  CREATE INDEX "figure_prototype_characters_character_idx" ON "figure_prototype_characters" USING btree ("character_id");
  CREATE INDEX "figure_prototype_characters_created_by_idx" ON "figure_prototype_characters" USING btree ("created_by_id");
  CREATE INDEX "figure_prototype_characters_deleted_by_idx" ON "figure_prototype_characters" USING btree ("deleted_by_id");
  CREATE INDEX "figure_prototype_characters_updated_at_idx" ON "figure_prototype_characters" USING btree ("updated_at");
  CREATE INDEX "figure_prototype_characters_created_at_idx" ON "figure_prototype_characters" USING btree ("created_at");
  CREATE UNIQUE INDEX "figure_versions_stable_id_idx" ON "figure_versions" USING btree ("stable_id");
  CREATE INDEX "figure_versions_prototype_idx" ON "figure_versions" USING btree ("prototype_id");
  CREATE INDEX "figure_versions_normalized_version_key_idx" ON "figure_versions" USING btree ("normalized_version_key");
  CREATE INDEX "figure_versions_created_by_idx" ON "figure_versions" USING btree ("created_by_id");
  CREATE INDEX "figure_versions_updated_by_idx" ON "figure_versions" USING btree ("updated_by_id");
  CREATE INDEX "figure_versions_deleted_by_idx" ON "figure_versions" USING btree ("deleted_by_id");
  CREATE INDEX "figure_versions_updated_at_idx" ON "figure_versions" USING btree ("updated_at");
  CREATE INDEX "figure_versions_created_at_idx" ON "figure_versions" USING btree ("created_at");
  CREATE UNIQUE INDEX "operation_logs_operation_id_idx" ON "operation_logs" USING btree ("operation_id");
  CREATE INDEX "operation_logs_actor_user_idx" ON "operation_logs" USING btree ("actor_user_id");
  CREATE INDEX "operation_logs_scope_stable_id_idx" ON "operation_logs" USING btree ("scope_stable_id");
  CREATE INDEX "operation_logs_updated_at_idx" ON "operation_logs" USING btree ("updated_at");
  CREATE INDEX "operation_logs_created_at_idx" ON "operation_logs" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_works_fk" FOREIGN KEY ("works_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_characters_fk" FOREIGN KEY ("characters_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_character_aliases_fk" FOREIGN KEY ("character_aliases_id") REFERENCES "public"."character_aliases"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_manufacturers_fk" FOREIGN KEY ("manufacturers_id") REFERENCES "public"."manufacturers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_figure_prototypes_fk" FOREIGN KEY ("figure_prototypes_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_figure_prototype_characters_fk" FOREIGN KEY ("figure_prototype_characters_id") REFERENCES "public"."figure_prototype_characters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_figure_versions_fk" FOREIGN KEY ("figure_versions_id") REFERENCES "public"."figure_versions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_operation_logs_fk" FOREIGN KEY ("operation_logs_id") REFERENCES "public"."operation_logs"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_works_id_idx" ON "payload_locked_documents_rels" USING btree ("works_id");
  CREATE INDEX "payload_locked_documents_rels_characters_id_idx" ON "payload_locked_documents_rels" USING btree ("characters_id");
  CREATE INDEX "payload_locked_documents_rels_character_aliases_id_idx" ON "payload_locked_documents_rels" USING btree ("character_aliases_id");
  CREATE INDEX "payload_locked_documents_rels_manufacturers_id_idx" ON "payload_locked_documents_rels" USING btree ("manufacturers_id");
  CREATE INDEX "payload_locked_documents_rels_figure_prototypes_id_idx" ON "payload_locked_documents_rels" USING btree ("figure_prototypes_id");
  CREATE INDEX "payload_locked_documents_rels_figure_prototype_character_idx" ON "payload_locked_documents_rels" USING btree ("figure_prototype_characters_id");
  CREATE INDEX "payload_locked_documents_rels_figure_versions_id_idx" ON "payload_locked_documents_rels" USING btree ("figure_versions_id");
  CREATE INDEX "payload_locked_documents_rels_operation_logs_id_idx" ON "payload_locked_documents_rels" USING btree ("operation_logs_id");

  ALTER TABLE "works" ADD CONSTRAINT "works_stable_id_uuid_chk" CHECK ("stable_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  ALTER TABLE "characters" ADD CONSTRAINT "characters_stable_id_uuid_chk" CHECK ("stable_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  ALTER TABLE "character_aliases" ADD CONSTRAINT "character_aliases_stable_id_uuid_chk" CHECK ("stable_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_stable_id_uuid_chk" CHECK ("stable_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_stable_id_uuid_chk" CHECK ("stable_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  ALTER TABLE "figure_prototype_characters" ADD CONSTRAINT "figure_prototype_characters_stable_id_uuid_chk" CHECK ("stable_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  ALTER TABLE "figure_versions" ADD CONSTRAINT "figure_versions_stable_id_uuid_chk" CHECK ("stable_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

  ALTER TABLE "works" ADD CONSTRAINT "works_lock_version_positive_chk" CHECK ("lock_version" > 0);
  ALTER TABLE "characters" ADD CONSTRAINT "characters_lock_version_positive_chk" CHECK ("lock_version" > 0);
  ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_lock_version_positive_chk" CHECK ("lock_version" > 0);
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_lock_version_positive_chk" CHECK ("lock_version" > 0);
  ALTER TABLE "figure_versions" ADD CONSTRAINT "figure_versions_lock_version_positive_chk" CHECK ("lock_version" > 0);

  ALTER TABLE "works" ADD CONSTRAINT "works_soft_delete_attribution_chk" CHECK ("deleted_at" IS NULL OR ("deleted_by_id" IS NOT NULL AND NULLIF(BTRIM("delete_reason"), '') IS NOT NULL));
  ALTER TABLE "characters" ADD CONSTRAINT "characters_soft_delete_attribution_chk" CHECK ("deleted_at" IS NULL OR ("deleted_by_id" IS NOT NULL AND NULLIF(BTRIM("delete_reason"), '') IS NOT NULL));
  ALTER TABLE "character_aliases" ADD CONSTRAINT "character_aliases_soft_delete_attribution_chk" CHECK ("deleted_at" IS NULL OR ("deleted_by_id" IS NOT NULL AND NULLIF(BTRIM("delete_reason"), '') IS NOT NULL));
  ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_soft_delete_attribution_chk" CHECK ("deleted_at" IS NULL OR ("deleted_by_id" IS NOT NULL AND NULLIF(BTRIM("delete_reason"), '') IS NOT NULL));
  ALTER TABLE "figure_prototype_characters" ADD CONSTRAINT "figure_prototype_characters_soft_delete_attribution_chk" CHECK ("deleted_at" IS NULL OR ("deleted_by_id" IS NOT NULL AND NULLIF(BTRIM("delete_reason"), '') IS NOT NULL));
  ALTER TABLE "figure_versions" ADD CONSTRAINT "figure_versions_soft_delete_attribution_chk" CHECK ("deleted_at" IS NULL OR ("deleted_by_id" IS NOT NULL AND NULLIF(BTRIM("delete_reason"), '') IS NOT NULL));

  ALTER TABLE "figure_prototype_characters" ADD CONSTRAINT "figure_prototype_characters_display_order_nonnegative_chk" CHECK ("display_order" >= 0 AND "display_order" = TRUNC("display_order"));
  ALTER TABLE "figure_versions" ADD CONSTRAINT "figure_versions_gray_completeness_chk" CHECK (("release_status" = 'gray_prototype' AND "gray_model_completeness" IN ('complete', 'partial', 'unknown')) OR ("release_status" <> 'gray_prototype' AND "gray_model_completeness" = 'not_applicable'));

  ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_operation_id_uuid_chk" CHECK ("operation_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_scope_stable_id_uuid_chk" CHECK ("scope_stable_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_request_digest_chk" CHECK ("request_digest" ~ '^[0-9a-f]{64}$');
  ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_expected_version_positive_chk" CHECK ("expected_version" IS NULL OR "expected_version" > 0);
  ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_result_version_positive_chk" CHECK ("result_version" > 0);
  ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_required_text_chk" CHECK (NULLIF(BTRIM("reason"), '') IS NOT NULL AND NULLIF(BTRIM("action"), '') IS NOT NULL AND NULLIF(BTRIM("scope_type"), '') IS NOT NULL);
  ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_not_reversible_chk" CHECK ("reversible" = false);

  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_adult_entry_false_chk" CHECK ("adult_entry_flag" = false);
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_publication_unavailable_chk" CHECK ("publication_status" <> 'published');
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_merged_target_chk" CHECK ("publication_status" <> 'merged' OR "merged_into_id" IS NOT NULL);
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_archive_attribution_chk" CHECK (("publication_status" = 'archived' AND "archived_at" IS NOT NULL AND "archived_by_id" IS NOT NULL AND NULLIF(BTRIM("archive_reason"), '') IS NOT NULL) OR ("publication_status" <> 'archived' AND "archived_at" IS NULL AND "archived_by_id" IS NULL AND "archive_reason" IS NULL));
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_rejected_authorization_chk" CHECK ("authorization_status" <> 'rejected' OR (NULLIF(BTRIM("authorization_reason"), '') IS NOT NULL AND "authorization_reviewed_by_id" IS NOT NULL AND "authorization_reviewed_at" IS NOT NULL AND "inclusion_status" = 'excluded'));
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_inclusion_review_chk" CHECK ("inclusion_status" = 'pending' OR (NULLIF(BTRIM("inclusion_reason"), '') IS NOT NULL AND "inclusion_reviewed_by_id" IS NOT NULL AND "inclusion_reviewed_at" IS NOT NULL));
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_eligible_authorization_chk" CHECK ("inclusion_status" <> 'eligible' OR "authorization_status" IN ('official', 'authorized_third_party'));

  CREATE UNIQUE INDEX "manufacturers_active_normalized_name_uq" ON "manufacturers" ("normalized_name") WHERE "deleted_at" IS NULL;
  CREATE UNIQUE INDEX "character_aliases_active_value_locale_uq" ON "character_aliases" ("character_id", "normalized_value", COALESCE("locale", '')) WHERE "deleted_at" IS NULL;
  CREATE UNIQUE INDEX "character_aliases_active_preferred_locale_uq" ON "character_aliases" ("character_id", COALESCE("locale", '')) WHERE "deleted_at" IS NULL AND "is_preferred" = true;
  CREATE UNIQUE INDEX "figure_prototype_characters_active_pair_uq" ON "figure_prototype_characters" ("prototype_id", "character_id") WHERE "deleted_at" IS NULL;
  CREATE UNIQUE INDEX "figure_prototype_characters_active_display_order_uq" ON "figure_prototype_characters" ("prototype_id", "display_order") WHERE "deleted_at" IS NULL;
  CREATE UNIQUE INDEX "figure_prototype_characters_active_primary_uq" ON "figure_prototype_characters" ("prototype_id") WHERE "deleted_at" IS NULL AND "role" = 'primary';
  CREATE UNIQUE INDEX "figure_versions_active_prototype_key_uq" ON "figure_versions" ("prototype_id", "normalized_version_key") WHERE "deleted_at" IS NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_works_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_characters_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_character_aliases_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_manufacturers_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_figure_prototypes_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_figure_prototype_characters_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_figure_versions_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_operation_logs_fk";

  DROP INDEX "payload_locked_documents_rels_works_id_idx";
  DROP INDEX "payload_locked_documents_rels_characters_id_idx";
  DROP INDEX "payload_locked_documents_rels_character_aliases_id_idx";
  DROP INDEX "payload_locked_documents_rels_manufacturers_id_idx";
  DROP INDEX "payload_locked_documents_rels_figure_prototypes_id_idx";
  DROP INDEX "payload_locked_documents_rels_figure_prototype_character_idx";
  DROP INDEX "payload_locked_documents_rels_figure_versions_id_idx";
  DROP INDEX "payload_locked_documents_rels_operation_logs_id_idx";

  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "works_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "characters_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "character_aliases_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "manufacturers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "figure_prototypes_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "figure_prototype_characters_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "figure_versions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "operation_logs_id";

  DROP INDEX "manufacturers_active_normalized_name_uq";
  DROP INDEX "character_aliases_active_value_locale_uq";
  DROP INDEX "character_aliases_active_preferred_locale_uq";
  DROP INDEX "figure_prototype_characters_active_pair_uq";
  DROP INDEX "figure_prototype_characters_active_display_order_uq";
  DROP INDEX "figure_prototype_characters_active_primary_uq";
  DROP INDEX "figure_versions_active_prototype_key_uq";

  ALTER TABLE "works" DROP CONSTRAINT "works_stable_id_uuid_chk";
  ALTER TABLE "characters" DROP CONSTRAINT "characters_stable_id_uuid_chk";
  ALTER TABLE "character_aliases" DROP CONSTRAINT "character_aliases_stable_id_uuid_chk";
  ALTER TABLE "manufacturers" DROP CONSTRAINT "manufacturers_stable_id_uuid_chk";
  ALTER TABLE "figure_prototypes" DROP CONSTRAINT "figure_prototypes_stable_id_uuid_chk";
  ALTER TABLE "figure_prototype_characters" DROP CONSTRAINT "figure_prototype_characters_stable_id_uuid_chk";
  ALTER TABLE "figure_versions" DROP CONSTRAINT "figure_versions_stable_id_uuid_chk";

  ALTER TABLE "works" DROP CONSTRAINT "works_lock_version_positive_chk";
  ALTER TABLE "characters" DROP CONSTRAINT "characters_lock_version_positive_chk";
  ALTER TABLE "manufacturers" DROP CONSTRAINT "manufacturers_lock_version_positive_chk";
  ALTER TABLE "figure_prototypes" DROP CONSTRAINT "figure_prototypes_lock_version_positive_chk";
  ALTER TABLE "figure_versions" DROP CONSTRAINT "figure_versions_lock_version_positive_chk";

  ALTER TABLE "works" DROP CONSTRAINT "works_soft_delete_attribution_chk";
  ALTER TABLE "characters" DROP CONSTRAINT "characters_soft_delete_attribution_chk";
  ALTER TABLE "character_aliases" DROP CONSTRAINT "character_aliases_soft_delete_attribution_chk";
  ALTER TABLE "manufacturers" DROP CONSTRAINT "manufacturers_soft_delete_attribution_chk";
  ALTER TABLE "figure_prototype_characters" DROP CONSTRAINT "figure_prototype_characters_soft_delete_attribution_chk";
  ALTER TABLE "figure_versions" DROP CONSTRAINT "figure_versions_soft_delete_attribution_chk";

  ALTER TABLE "figure_prototype_characters" DROP CONSTRAINT "figure_prototype_characters_display_order_nonnegative_chk";
  ALTER TABLE "figure_versions" DROP CONSTRAINT "figure_versions_gray_completeness_chk";

  ALTER TABLE "operation_logs" DROP CONSTRAINT "operation_logs_operation_id_uuid_chk";
  ALTER TABLE "operation_logs" DROP CONSTRAINT "operation_logs_scope_stable_id_uuid_chk";
  ALTER TABLE "operation_logs" DROP CONSTRAINT "operation_logs_request_digest_chk";
  ALTER TABLE "operation_logs" DROP CONSTRAINT "operation_logs_expected_version_positive_chk";
  ALTER TABLE "operation_logs" DROP CONSTRAINT "operation_logs_result_version_positive_chk";
  ALTER TABLE "operation_logs" DROP CONSTRAINT "operation_logs_required_text_chk";
  ALTER TABLE "operation_logs" DROP CONSTRAINT "operation_logs_not_reversible_chk";

  ALTER TABLE "figure_prototypes" DROP CONSTRAINT "figure_prototypes_adult_entry_false_chk";
  ALTER TABLE "figure_prototypes" DROP CONSTRAINT "figure_prototypes_publication_unavailable_chk";
  ALTER TABLE "figure_prototypes" DROP CONSTRAINT "figure_prototypes_merged_target_chk";
  ALTER TABLE "figure_prototypes" DROP CONSTRAINT "figure_prototypes_archive_attribution_chk";
  ALTER TABLE "figure_prototypes" DROP CONSTRAINT "figure_prototypes_rejected_authorization_chk";
  ALTER TABLE "figure_prototypes" DROP CONSTRAINT "figure_prototypes_inclusion_review_chk";
  ALTER TABLE "figure_prototypes" DROP CONSTRAINT "figure_prototypes_eligible_authorization_chk";

  ALTER TABLE "works" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "characters" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "character_aliases" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "manufacturers_aliases" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "manufacturers" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "figure_prototypes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "figure_prototype_characters" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "figure_versions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "operation_logs" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "operation_logs" CASCADE;
  DROP TABLE "figure_versions" CASCADE;
  DROP TABLE "figure_prototype_characters" CASCADE;
  DROP TABLE "figure_prototypes" CASCADE;
  DROP TABLE "character_aliases" CASCADE;
  DROP TABLE "characters" CASCADE;
  DROP TABLE "manufacturers_aliases" CASCADE;
  DROP TABLE "manufacturers" CASCADE;
  DROP TABLE "works" CASCADE;
  DROP TYPE "public"."enum_works_work_type";
  DROP TYPE "public"."enum_works_publication_status";
  DROP TYPE "public"."enum_characters_status";
  DROP TYPE "public"."enum_character_aliases_alias_type";
  DROP TYPE "public"."enum_manufacturers_status";
  DROP TYPE "public"."enum_figure_prototypes_figure_type";
  DROP TYPE "public"."enum_figure_prototypes_authorization_status";
  DROP TYPE "public"."enum_figure_prototypes_inclusion_status";
  DROP TYPE "public"."enum_figure_prototypes_publication_status";
  DROP TYPE "public"."enum_figure_prototype_characters_role";
  DROP TYPE "public"."enum_figure_versions_kind";
  DROP TYPE "public"."enum_figure_versions_release_status";
  DROP TYPE "public"."enum_figure_versions_gray_model_completeness";
  DROP TYPE "public"."enum_operation_logs_actor_type";
  DROP TYPE "public"."enum_operation_logs_duty_context";`)
}
