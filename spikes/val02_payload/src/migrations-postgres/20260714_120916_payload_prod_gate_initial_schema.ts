import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_users_role" AS ENUM('admin', 'candidate-client');
  CREATE TYPE "public"."enum_works_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__works_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_characters_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_characters_domain_status" AS ENUM('active', 'hidden', 'matching-pending');
  CREATE TYPE "public"."enum__characters_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_manufacturers_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_manufacturers_domain_status" AS ENUM('draft', 'active', 'hidden');
  CREATE TYPE "public"."enum__manufacturers_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_figure_prototypes_figure_type" AS ENUM('scale', 'prize');
  CREATE TYPE "public"."enum_figure_prototypes_publication_status" AS ENUM('draft', 'published', 'hidden', 'merged');
  CREATE TYPE "public"."enum_figure_prototypes_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__figure_prototypes_v_version_figure_type" AS ENUM('scale', 'prize');
  CREATE TYPE "public"."enum__figure_prototypes_v_version_publication_status" AS ENUM('draft', 'published', 'hidden', 'merged');
  CREATE TYPE "public"."enum__figure_prototypes_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_figure_versions_kind" AS ENUM('standard', 'deluxe', 'reissue', 'bonus', 'recolor', 'channel-limited');
  CREATE TYPE "public"."enum__figure_versions_v_version_kind" AS ENUM('standard', 'deluxe', 'reissue', 'bonus', 'recolor', 'channel-limited');
  CREATE TYPE "public"."enum_source_records_status" AS ENUM('active', 'missing', 'blocked');
  CREATE TYPE "public"."enum_candidate_records_status" AS ENUM('pending', 'accepted', 'deferred', 'ignored', 'merged', 'update_pending');
  CREATE TYPE "public"."enum_candidate_records_match_state" AS ENUM('character_pending', 'manufacturer_pending', 'matched');
  CREATE TYPE "public"."enum_candidate_records_proposed_manufacturer_status" AS ENUM('draft', 'active', 'hidden');
  CREATE TYPE "public"."enum__candidate_records_v_version_status" AS ENUM('pending', 'accepted', 'deferred', 'ignored', 'merged', 'update_pending');
  CREATE TYPE "public"."enum__candidate_records_v_version_match_state" AS ENUM('character_pending', 'manufacturer_pending', 'matched');
  CREATE TYPE "public"."enum__candidate_records_v_version_proposed_manufacturer_status" AS ENUM('draft', 'active', 'hidden');
  CREATE TYPE "public"."enum_review_work_items_status" AS ENUM('open', 'completed', 'cancelled');
  CREATE TYPE "public"."enum_operation_logs_operation_type" AS ENUM('candidate_upsert', 'candidate_media_upload', 'client_revoked', 'create_manufacturer', 'create_prototype', 'attach_version', 'accept_field', 'reject_field', 'defer_candidate', 'ignore_candidate', 'set_manufacturer_status', 'set_prototype_publication', 'select_main_image', 'update_settings', 'merge', 'split', 'undo_merge', 'undo_split', 'review_work_item_opened', 'review_work_item_reopened', 'review_work_item_completed', 'maintain_formal');
  CREATE TABLE "users_sessions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone,
	"expires_at" timestamp(3) with time zone NOT NULL
  );

  CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" "enum_users_role" DEFAULT 'candidate-client' NOT NULL,
	"candidate_client_i_d" varchar,
	"candidate_active" boolean DEFAULT true NOT NULL,
	"candidate_token_hash" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"enable_a_p_i_key" boolean,
	"api_key" varchar,
	"api_key_index" varchar,
	"email" varchar NOT NULL,
	"reset_password_token" varchar,
	"reset_password_expiration" timestamp(3) with time zone,
	"salt" varchar,
	"hash" varchar,
	"login_attempts" numeric DEFAULT 0,
	"lock_until" timestamp(3) with time zone
  );

  CREATE TABLE "works" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixture_i_d" varchar,
	"name" varchar,
	"original_name" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"_status" "enum_works_status" DEFAULT 'draft'
  );

  CREATE TABLE "works_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
  );

  CREATE TABLE "_works_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_fixture_i_d" varchar,
	"version_name" varchar,
	"version_original_name" varchar,
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version_deleted_at" timestamp(3) with time zone,
	"version__status" "enum__works_v_version_status" DEFAULT 'draft',
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean
  );

  CREATE TABLE "_works_v_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
  );

  CREATE TABLE "characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixture_i_d" varchar,
	"display_name" varchar,
	"name_zh" varchar,
	"name_ja" varchar,
	"name_en" varchar,
	"work_id" integer,
	"status" "enum_characters_domain_status" DEFAULT 'active',
	"soft_deleted" boolean DEFAULT false,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"_status" "enum_characters_status" DEFAULT 'draft'
  );

  CREATE TABLE "characters_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
  );

  CREATE TABLE "_characters_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_fixture_i_d" varchar,
	"version_display_name" varchar,
	"version_name_zh" varchar,
	"version_name_ja" varchar,
	"version_name_en" varchar,
	"version_work_id" integer,
	"version_status" "enum_characters_domain_status" DEFAULT 'active',
	"version_soft_deleted" boolean DEFAULT false,
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version_deleted_at" timestamp(3) with time zone,
	"version__status" "enum__characters_v_version_status" DEFAULT 'draft',
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean
  );

  CREATE TABLE "_characters_v_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
  );

  CREATE TABLE "manufacturers" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixture_i_d" varchar,
	"canonical_name" varchar,
	"status" "enum_manufacturers_domain_status" DEFAULT 'draft',
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"_status" "enum_manufacturers_status" DEFAULT 'draft'
  );

  CREATE TABLE "manufacturers_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
  );

  CREATE TABLE "_manufacturers_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_fixture_i_d" varchar,
	"version_canonical_name" varchar,
	"version_status" "enum_manufacturers_domain_status" DEFAULT 'draft',
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version_deleted_at" timestamp(3) with time zone,
	"version__status" "enum__manufacturers_v_version_status" DEFAULT 'draft',
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean
  );

  CREATE TABLE "_manufacturers_v_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
  );

  CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixture_i_d" varchar,
	"candidate_only" boolean DEFAULT true NOT NULL,
	"candidate_id" integer,
	"candidate_owner_id" integer,
	"client_candidate_i_d" varchar,
	"idempotency_key" varchar,
	"prototype_id" integer,
	"source_url" varchar NOT NULL,
	"storage_key" varchar NOT NULL,
	"byte_size" numeric,
	"pixel_width" numeric,
	"pixel_height" numeric,
	"format" varchar,
	"sha256" varchar NOT NULL,
	"perceptual_hash" varchar,
	"is_adult" boolean DEFAULT false NOT NULL,
	"is_source_homepage" boolean DEFAULT false NOT NULL,
	"present_in_latest_source" boolean DEFAULT true NOT NULL,
	"selected_as_main" boolean DEFAULT false NOT NULL,
	"prefix" varchar DEFAULT '',
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"url" varchar,
	"thumbnail_u_r_l" varchar,
	"filename" varchar,
	"mime_type" varchar,
	"filesize" numeric,
	"width" numeric,
	"height" numeric,
	"focal_x" numeric,
	"focal_y" numeric,
	"sizes_thumbnail_url" varchar,
	"sizes_thumbnail_width" numeric,
	"sizes_thumbnail_height" numeric,
	"sizes_thumbnail_mime_type" varchar,
	"sizes_thumbnail_filesize" numeric,
	"sizes_thumbnail_filename" varchar,
	"sizes_preview_url" varchar,
	"sizes_preview_width" numeric,
	"sizes_preview_height" numeric,
	"sizes_preview_mime_type" varchar,
	"sizes_preview_filesize" numeric,
	"sizes_preview_filename" varchar
  );

  CREATE TABLE "figure_prototypes" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixture_i_d" varchar,
	"title" varchar,
	"work_id" integer,
	"manufacturer_id" integer,
	"figure_type" "enum_figure_prototypes_figure_type",
	"scale" varchar,
	"costume_text" varchar,
	"is_group" boolean DEFAULT false,
	"is_adult" boolean DEFAULT false,
	"publication_status" "enum_figure_prototypes_publication_status" DEFAULT 'draft',
	"soft_deleted" boolean DEFAULT false,
	"lock_version" numeric DEFAULT 1,
	"main_image_id" integer,
	"merged_into_id" integer,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"_status" "enum_figure_prototypes_status" DEFAULT 'draft'
  );

  CREATE TABLE "figure_prototypes_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"characters_id" integer
  );

  CREATE TABLE "_figure_prototypes_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_fixture_i_d" varchar,
	"version_title" varchar,
	"version_work_id" integer,
	"version_manufacturer_id" integer,
	"version_figure_type" "enum__figure_prototypes_v_version_figure_type",
	"version_scale" varchar,
	"version_costume_text" varchar,
	"version_is_group" boolean DEFAULT false,
	"version_is_adult" boolean DEFAULT false,
	"version_publication_status" "enum__figure_prototypes_v_version_publication_status" DEFAULT 'draft',
	"version_soft_deleted" boolean DEFAULT false,
	"version_lock_version" numeric DEFAULT 1,
	"version_main_image_id" integer,
	"version_merged_into_id" integer,
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version_deleted_at" timestamp(3) with time zone,
	"version__status" "enum__figure_prototypes_v_version_status" DEFAULT 'draft',
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean
  );

  CREATE TABLE "_figure_prototypes_v_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"characters_id" integer
  );

  CREATE TABLE "figure_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixture_i_d" varchar,
	"prototype_id" integer NOT NULL,
	"name" varchar NOT NULL,
	"kind" "enum_figure_versions_kind" NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
  );

  CREATE TABLE "_figure_versions_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_fixture_i_d" varchar,
	"version_prototype_id" integer NOT NULL,
	"version_name" varchar NOT NULL,
	"version_kind" "enum__figure_versions_v_version_kind" NOT NULL,
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version_deleted_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "source_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixture_i_d" varchar,
	"candidate_only" boolean DEFAULT true NOT NULL,
	"candidate_owner_id" integer,
	"source_type" varchar NOT NULL,
	"source_item_id" varchar,
	"source_url" varchar NOT NULL,
	"canonical_url" varchar NOT NULL,
	"source_key" varchar NOT NULL,
	"status" "enum_source_records_status" NOT NULL,
	"last_synced_at" timestamp(3) with time zone,
	"invalidated" boolean DEFAULT false NOT NULL,
	"raw_snapshot" jsonb NOT NULL,
	"prototype_id" integer,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
  );

  CREATE TABLE "candidate_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_key" varchar NOT NULL,
	"candidate_owner_id" integer,
	"source_id" integer NOT NULL,
	"raw_title" varchar NOT NULL,
	"raw_work_name" varchar,
	"raw_manufacturer" varchar,
	"raw_category" varchar,
	"raw_scale" varchar,
	"raw_date" varchar,
	"raw_snapshot" jsonb NOT NULL,
	"status" "enum_candidate_records_status" DEFAULT 'pending' NOT NULL,
	"reason" varchar,
	"match_state" "enum_candidate_records_match_state" DEFAULT 'character_pending' NOT NULL,
	"proposed_manufacturer_status" "enum_candidate_records_proposed_manufacturer_status",
	"requested_changes" jsonb,
	"accepted_fields" jsonb,
	"rejected_fields" jsonb,
	"target_prototype_id" integer,
	"target_version_id" integer,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
  );

  CREATE TABLE "candidate_records_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
  );

  CREATE TABLE "candidate_records_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"media_id" integer
  );

  CREATE TABLE "_candidate_records_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_external_key" varchar NOT NULL,
	"version_candidate_owner_id" integer,
	"version_source_id" integer NOT NULL,
	"version_raw_title" varchar NOT NULL,
	"version_raw_work_name" varchar,
	"version_raw_manufacturer" varchar,
	"version_raw_category" varchar,
	"version_raw_scale" varchar,
	"version_raw_date" varchar,
	"version_raw_snapshot" jsonb NOT NULL,
	"version_status" "enum__candidate_records_v_version_status" DEFAULT 'pending' NOT NULL,
	"version_reason" varchar,
	"version_match_state" "enum__candidate_records_v_version_match_state" DEFAULT 'character_pending' NOT NULL,
	"version_proposed_manufacturer_status" "enum__candidate_records_v_version_proposed_manufacturer_status",
	"version_requested_changes" jsonb,
	"version_accepted_fields" jsonb,
	"version_rejected_fields" jsonb,
	"version_target_prototype_id" integer,
	"version_target_version_id" integer,
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version_deleted_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "_candidate_records_v_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
  );

  CREATE TABLE "_candidate_records_v_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"media_id" integer
  );

  CREATE TABLE "review_work_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"status" "enum_review_work_items_status" DEFAULT 'open' NOT NULL,
	"lock_version" numeric DEFAULT 1 NOT NULL,
	"started_at" timestamp(3) with time zone NOT NULL,
	"completed_at" timestamp(3) with time zone,
	"decision_reason" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
  );

  CREATE TABLE "review_work_items_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"figure_prototypes_id" integer
  );

  CREATE TABLE "operation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixture_i_d" varchar,
	"operation_i_d" varchar,
	"operation_version" numeric DEFAULT 1 NOT NULL,
	"scope" jsonb,
	"depends_on" jsonb,
	"actor_id" integer,
	"actor_label" varchar NOT NULL,
	"operation_type" "enum_operation_logs_operation_type" NOT NULL,
	"reason" varchar NOT NULL,
	"before_state" jsonb NOT NULL,
	"after_state" jsonb NOT NULL,
	"related_records" jsonb NOT NULL,
	"inverse_payload" jsonb,
	"undone" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_kv" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar NOT NULL,
	"data" jsonb NOT NULL
  );

  CREATE TABLE "payload_locked_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"global_slug" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_locked_documents_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"users_id" integer,
	"works_id" integer,
	"characters_id" integer,
	"manufacturers_id" integer,
	"media_id" integer,
	"figure_prototypes_id" integer,
	"figure_versions_id" integer,
	"source_records_id" integer,
	"candidate_records_id" integer,
	"review_work_items_id" integer,
	"operation_logs_id" integer
  );

  CREATE TABLE "payload_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar,
	"value" jsonb,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_preferences_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"users_id" integer
  );

  CREATE TABLE "payload_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"batch" numeric,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"show_adult_images" boolean DEFAULT false NOT NULL,
	"gallery_page_size" numeric DEFAULT 16 NOT NULL,
	"public_read_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone
  );

  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "works_texts" ADD CONSTRAINT "works_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_works_v" ADD CONSTRAINT "_works_v_parent_id_works_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_works_v_texts" ADD CONSTRAINT "_works_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_works_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "characters" ADD CONSTRAINT "characters_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "characters_texts" ADD CONSTRAINT "characters_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_characters_v" ADD CONSTRAINT "_characters_v_parent_id_characters_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_characters_v" ADD CONSTRAINT "_characters_v_version_work_id_works_id_fk" FOREIGN KEY ("version_work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_characters_v_texts" ADD CONSTRAINT "_characters_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_characters_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "manufacturers_texts" ADD CONSTRAINT "manufacturers_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."manufacturers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_manufacturers_v" ADD CONSTRAINT "_manufacturers_v_parent_id_manufacturers_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."manufacturers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_manufacturers_v_texts" ADD CONSTRAINT "_manufacturers_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_manufacturers_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "media" ADD CONSTRAINT "media_candidate_id_candidate_records_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_records"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "media" ADD CONSTRAINT "media_candidate_owner_id_users_id_fk" FOREIGN KEY ("candidate_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "media" ADD CONSTRAINT "media_prototype_id_figure_prototypes_id_fk" FOREIGN KEY ("prototype_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_main_image_id_media_id_fk" FOREIGN KEY ("main_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototypes" ADD CONSTRAINT "figure_prototypes_merged_into_id_figure_prototypes_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "figure_prototypes_rels" ADD CONSTRAINT "figure_prototypes_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "figure_prototypes_rels" ADD CONSTRAINT "figure_prototypes_rels_characters_fk" FOREIGN KEY ("characters_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_figure_prototypes_v" ADD CONSTRAINT "_figure_prototypes_v_parent_id_figure_prototypes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_figure_prototypes_v" ADD CONSTRAINT "_figure_prototypes_v_version_work_id_works_id_fk" FOREIGN KEY ("version_work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_figure_prototypes_v" ADD CONSTRAINT "_figure_prototypes_v_version_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("version_manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_figure_prototypes_v" ADD CONSTRAINT "_figure_prototypes_v_version_main_image_id_media_id_fk" FOREIGN KEY ("version_main_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_figure_prototypes_v" ADD CONSTRAINT "_figure_prototypes_v_version_merged_into_id_figure_prototypes_id_fk" FOREIGN KEY ("version_merged_into_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_figure_prototypes_v_rels" ADD CONSTRAINT "_figure_prototypes_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_figure_prototypes_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_figure_prototypes_v_rels" ADD CONSTRAINT "_figure_prototypes_v_rels_characters_fk" FOREIGN KEY ("characters_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "figure_versions" ADD CONSTRAINT "figure_versions_prototype_id_figure_prototypes_id_fk" FOREIGN KEY ("prototype_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_figure_versions_v" ADD CONSTRAINT "_figure_versions_v_parent_id_figure_versions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."figure_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_figure_versions_v" ADD CONSTRAINT "_figure_versions_v_version_prototype_id_figure_prototypes_id_fk" FOREIGN KEY ("version_prototype_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_candidate_owner_id_users_id_fk" FOREIGN KEY ("candidate_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "source_records" ADD CONSTRAINT "source_records_prototype_id_figure_prototypes_id_fk" FOREIGN KEY ("prototype_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "candidate_records" ADD CONSTRAINT "candidate_records_candidate_owner_id_users_id_fk" FOREIGN KEY ("candidate_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "candidate_records" ADD CONSTRAINT "candidate_records_source_id_source_records_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "candidate_records" ADD CONSTRAINT "candidate_records_target_prototype_id_figure_prototypes_id_fk" FOREIGN KEY ("target_prototype_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "candidate_records" ADD CONSTRAINT "candidate_records_target_version_id_figure_versions_id_fk" FOREIGN KEY ("target_version_id") REFERENCES "public"."figure_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "candidate_records_texts" ADD CONSTRAINT "candidate_records_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."candidate_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "candidate_records_rels" ADD CONSTRAINT "candidate_records_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."candidate_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "candidate_records_rels" ADD CONSTRAINT "candidate_records_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_candidate_records_v" ADD CONSTRAINT "_candidate_records_v_parent_id_candidate_records_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."candidate_records"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_candidate_records_v" ADD CONSTRAINT "_candidate_records_v_version_candidate_owner_id_users_id_fk" FOREIGN KEY ("version_candidate_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_candidate_records_v" ADD CONSTRAINT "_candidate_records_v_version_source_id_source_records_id_fk" FOREIGN KEY ("version_source_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_candidate_records_v" ADD CONSTRAINT "_candidate_records_v_version_target_prototype_id_figure_prototypes_id_fk" FOREIGN KEY ("version_target_prototype_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_candidate_records_v" ADD CONSTRAINT "_candidate_records_v_version_target_version_id_figure_versions_id_fk" FOREIGN KEY ("version_target_version_id") REFERENCES "public"."figure_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_candidate_records_v_texts" ADD CONSTRAINT "_candidate_records_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_candidate_records_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_candidate_records_v_rels" ADD CONSTRAINT "_candidate_records_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_candidate_records_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_candidate_records_v_rels" ADD CONSTRAINT "_candidate_records_v_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "review_work_items" ADD CONSTRAINT "review_work_items_candidate_id_candidate_records_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_records"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "review_work_items" ADD CONSTRAINT "review_work_items_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "review_work_items_rels" ADD CONSTRAINT "review_work_items_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."review_work_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "review_work_items_rels" ADD CONSTRAINT "review_work_items_rels_figure_prototypes_fk" FOREIGN KEY ("figure_prototypes_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_works_fk" FOREIGN KEY ("works_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_characters_fk" FOREIGN KEY ("characters_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_manufacturers_fk" FOREIGN KEY ("manufacturers_id") REFERENCES "public"."manufacturers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_figure_prototypes_fk" FOREIGN KEY ("figure_prototypes_id") REFERENCES "public"."figure_prototypes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_figure_versions_fk" FOREIGN KEY ("figure_versions_id") REFERENCES "public"."figure_versions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_records_fk" FOREIGN KEY ("source_records_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_candidate_records_fk" FOREIGN KEY ("candidate_records_id") REFERENCES "public"."candidate_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_review_work_items_fk" FOREIGN KEY ("review_work_items_id") REFERENCES "public"."review_work_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_operation_logs_fk" FOREIGN KEY ("operation_logs_id") REFERENCES "public"."operation_logs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "users_candidate_client_i_d_idx" ON "users" USING btree ("candidate_client_i_d");
  CREATE UNIQUE INDEX "users_candidate_token_hash_idx" ON "users" USING btree ("candidate_token_hash");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE UNIQUE INDEX "works_fixture_i_d_idx" ON "works" USING btree ("fixture_i_d");
  CREATE INDEX "works_updated_at_idx" ON "works" USING btree ("updated_at");
  CREATE INDEX "works_created_at_idx" ON "works" USING btree ("created_at");
  CREATE INDEX "works_deleted_at_idx" ON "works" USING btree ("deleted_at");
  CREATE INDEX "works__status_idx" ON "works" USING btree ("_status");
  CREATE INDEX "works_texts_order_parent" ON "works_texts" USING btree ("order","parent_id");
  CREATE INDEX "_works_v_parent_idx" ON "_works_v" USING btree ("parent_id");
  CREATE INDEX "_works_v_version_version_fixture_i_d_idx" ON "_works_v" USING btree ("version_fixture_i_d");
  CREATE INDEX "_works_v_version_version_updated_at_idx" ON "_works_v" USING btree ("version_updated_at");
  CREATE INDEX "_works_v_version_version_created_at_idx" ON "_works_v" USING btree ("version_created_at");
  CREATE INDEX "_works_v_version_version_deleted_at_idx" ON "_works_v" USING btree ("version_deleted_at");
  CREATE INDEX "_works_v_version_version__status_idx" ON "_works_v" USING btree ("version__status");
  CREATE INDEX "_works_v_created_at_idx" ON "_works_v" USING btree ("created_at");
  CREATE INDEX "_works_v_updated_at_idx" ON "_works_v" USING btree ("updated_at");
  CREATE INDEX "_works_v_latest_idx" ON "_works_v" USING btree ("latest");
  CREATE INDEX "_works_v_texts_order_parent" ON "_works_v_texts" USING btree ("order","parent_id");
  CREATE UNIQUE INDEX "characters_fixture_i_d_idx" ON "characters" USING btree ("fixture_i_d");
  CREATE INDEX "characters_display_name_idx" ON "characters" USING btree ("display_name");
  CREATE INDEX "characters_name_zh_idx" ON "characters" USING btree ("name_zh");
  CREATE INDEX "characters_name_ja_idx" ON "characters" USING btree ("name_ja");
  CREATE INDEX "characters_name_en_idx" ON "characters" USING btree ("name_en");
  CREATE INDEX "characters_work_idx" ON "characters" USING btree ("work_id");
  CREATE INDEX "characters_updated_at_idx" ON "characters" USING btree ("updated_at");
  CREATE INDEX "characters_created_at_idx" ON "characters" USING btree ("created_at");
  CREATE INDEX "characters_deleted_at_idx" ON "characters" USING btree ("deleted_at");
  CREATE INDEX "characters__status_idx" ON "characters" USING btree ("_status");
  CREATE INDEX "characters_texts_order_parent" ON "characters_texts" USING btree ("order","parent_id");
  CREATE INDEX "characters_texts_text_idx" ON "characters_texts" USING btree ("text");
  CREATE INDEX "_characters_v_parent_idx" ON "_characters_v" USING btree ("parent_id");
  CREATE INDEX "_characters_v_version_version_fixture_i_d_idx" ON "_characters_v" USING btree ("version_fixture_i_d");
  CREATE INDEX "_characters_v_version_version_display_name_idx" ON "_characters_v" USING btree ("version_display_name");
  CREATE INDEX "_characters_v_version_version_name_zh_idx" ON "_characters_v" USING btree ("version_name_zh");
  CREATE INDEX "_characters_v_version_version_name_ja_idx" ON "_characters_v" USING btree ("version_name_ja");
  CREATE INDEX "_characters_v_version_version_name_en_idx" ON "_characters_v" USING btree ("version_name_en");
  CREATE INDEX "_characters_v_version_version_work_idx" ON "_characters_v" USING btree ("version_work_id");
  CREATE INDEX "_characters_v_version_version_updated_at_idx" ON "_characters_v" USING btree ("version_updated_at");
  CREATE INDEX "_characters_v_version_version_created_at_idx" ON "_characters_v" USING btree ("version_created_at");
  CREATE INDEX "_characters_v_version_version_deleted_at_idx" ON "_characters_v" USING btree ("version_deleted_at");
  CREATE INDEX "_characters_v_version_version__status_idx" ON "_characters_v" USING btree ("version__status");
  CREATE INDEX "_characters_v_created_at_idx" ON "_characters_v" USING btree ("created_at");
  CREATE INDEX "_characters_v_updated_at_idx" ON "_characters_v" USING btree ("updated_at");
  CREATE INDEX "_characters_v_latest_idx" ON "_characters_v" USING btree ("latest");
  CREATE INDEX "_characters_v_texts_order_parent" ON "_characters_v_texts" USING btree ("order","parent_id");
  CREATE UNIQUE INDEX "manufacturers_fixture_i_d_idx" ON "manufacturers" USING btree ("fixture_i_d");
  CREATE INDEX "manufacturers_canonical_name_idx" ON "manufacturers" USING btree ("canonical_name");
  CREATE INDEX "manufacturers_updated_at_idx" ON "manufacturers" USING btree ("updated_at");
  CREATE INDEX "manufacturers_created_at_idx" ON "manufacturers" USING btree ("created_at");
  CREATE INDEX "manufacturers_deleted_at_idx" ON "manufacturers" USING btree ("deleted_at");
  CREATE INDEX "manufacturers__status_idx" ON "manufacturers" USING btree ("_status");
  CREATE INDEX "manufacturers_texts_order_parent" ON "manufacturers_texts" USING btree ("order","parent_id");
  CREATE INDEX "_manufacturers_v_parent_idx" ON "_manufacturers_v" USING btree ("parent_id");
  CREATE INDEX "_manufacturers_v_version_version_fixture_i_d_idx" ON "_manufacturers_v" USING btree ("version_fixture_i_d");
  CREATE INDEX "_manufacturers_v_version_version_canonical_name_idx" ON "_manufacturers_v" USING btree ("version_canonical_name");
  CREATE INDEX "_manufacturers_v_version_version_updated_at_idx" ON "_manufacturers_v" USING btree ("version_updated_at");
  CREATE INDEX "_manufacturers_v_version_version_created_at_idx" ON "_manufacturers_v" USING btree ("version_created_at");
  CREATE INDEX "_manufacturers_v_version_version_deleted_at_idx" ON "_manufacturers_v" USING btree ("version_deleted_at");
  CREATE INDEX "_manufacturers_v_version_version__status_idx" ON "_manufacturers_v" USING btree ("version__status");
  CREATE INDEX "_manufacturers_v_created_at_idx" ON "_manufacturers_v" USING btree ("created_at");
  CREATE INDEX "_manufacturers_v_updated_at_idx" ON "_manufacturers_v" USING btree ("updated_at");
  CREATE INDEX "_manufacturers_v_latest_idx" ON "_manufacturers_v" USING btree ("latest");
  CREATE INDEX "_manufacturers_v_texts_order_parent" ON "_manufacturers_v_texts" USING btree ("order","parent_id");
  CREATE UNIQUE INDEX "media_fixture_i_d_idx" ON "media" USING btree ("fixture_i_d");
  CREATE INDEX "media_candidate_idx" ON "media" USING btree ("candidate_id");
  CREATE INDEX "media_candidate_owner_idx" ON "media" USING btree ("candidate_owner_id");
  CREATE INDEX "media_client_candidate_i_d_idx" ON "media" USING btree ("client_candidate_i_d");
  CREATE INDEX "media_idempotency_key_idx" ON "media" USING btree ("idempotency_key");
  CREATE INDEX "media_prototype_idx" ON "media" USING btree ("prototype_id");
  CREATE INDEX "media_storage_key_idx" ON "media" USING btree ("storage_key");
  CREATE INDEX "media_sha256_idx" ON "media" USING btree ("sha256");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE INDEX "media_deleted_at_idx" ON "media" USING btree ("deleted_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "media" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "media_sizes_preview_sizes_preview_filename_idx" ON "media" USING btree ("sizes_preview_filename");
  CREATE UNIQUE INDEX "figure_prototypes_fixture_i_d_idx" ON "figure_prototypes" USING btree ("fixture_i_d");
  CREATE INDEX "figure_prototypes_work_idx" ON "figure_prototypes" USING btree ("work_id");
  CREATE INDEX "figure_prototypes_manufacturer_idx" ON "figure_prototypes" USING btree ("manufacturer_id");
  CREATE INDEX "figure_prototypes_main_image_idx" ON "figure_prototypes" USING btree ("main_image_id");
  CREATE INDEX "figure_prototypes_merged_into_idx" ON "figure_prototypes" USING btree ("merged_into_id");
  CREATE INDEX "figure_prototypes_updated_at_idx" ON "figure_prototypes" USING btree ("updated_at");
  CREATE INDEX "figure_prototypes_created_at_idx" ON "figure_prototypes" USING btree ("created_at");
  CREATE INDEX "figure_prototypes_deleted_at_idx" ON "figure_prototypes" USING btree ("deleted_at");
  CREATE INDEX "figure_prototypes__status_idx" ON "figure_prototypes" USING btree ("_status");
  CREATE INDEX "figure_prototypes_rels_order_idx" ON "figure_prototypes_rels" USING btree ("order");
  CREATE INDEX "figure_prototypes_rels_parent_idx" ON "figure_prototypes_rels" USING btree ("parent_id");
  CREATE INDEX "figure_prototypes_rels_path_idx" ON "figure_prototypes_rels" USING btree ("path");
  CREATE INDEX "figure_prototypes_rels_characters_id_idx" ON "figure_prototypes_rels" USING btree ("characters_id");
  CREATE INDEX "_figure_prototypes_v_parent_idx" ON "_figure_prototypes_v" USING btree ("parent_id");
  CREATE INDEX "_figure_prototypes_v_version_version_fixture_i_d_idx" ON "_figure_prototypes_v" USING btree ("version_fixture_i_d");
  CREATE INDEX "_figure_prototypes_v_version_version_work_idx" ON "_figure_prototypes_v" USING btree ("version_work_id");
  CREATE INDEX "_figure_prototypes_v_version_version_manufacturer_idx" ON "_figure_prototypes_v" USING btree ("version_manufacturer_id");
  CREATE INDEX "_figure_prototypes_v_version_version_main_image_idx" ON "_figure_prototypes_v" USING btree ("version_main_image_id");
  CREATE INDEX "_figure_prototypes_v_version_version_merged_into_idx" ON "_figure_prototypes_v" USING btree ("version_merged_into_id");
  CREATE INDEX "_figure_prototypes_v_version_version_updated_at_idx" ON "_figure_prototypes_v" USING btree ("version_updated_at");
  CREATE INDEX "_figure_prototypes_v_version_version_created_at_idx" ON "_figure_prototypes_v" USING btree ("version_created_at");
  CREATE INDEX "_figure_prototypes_v_version_version_deleted_at_idx" ON "_figure_prototypes_v" USING btree ("version_deleted_at");
  CREATE INDEX "_figure_prototypes_v_version_version__status_idx" ON "_figure_prototypes_v" USING btree ("version__status");
  CREATE INDEX "_figure_prototypes_v_created_at_idx" ON "_figure_prototypes_v" USING btree ("created_at");
  CREATE INDEX "_figure_prototypes_v_updated_at_idx" ON "_figure_prototypes_v" USING btree ("updated_at");
  CREATE INDEX "_figure_prototypes_v_latest_idx" ON "_figure_prototypes_v" USING btree ("latest");
  CREATE INDEX "_figure_prototypes_v_rels_order_idx" ON "_figure_prototypes_v_rels" USING btree ("order");
  CREATE INDEX "_figure_prototypes_v_rels_parent_idx" ON "_figure_prototypes_v_rels" USING btree ("parent_id");
  CREATE INDEX "_figure_prototypes_v_rels_path_idx" ON "_figure_prototypes_v_rels" USING btree ("path");
  CREATE INDEX "_figure_prototypes_v_rels_characters_id_idx" ON "_figure_prototypes_v_rels" USING btree ("characters_id");
  CREATE UNIQUE INDEX "figure_versions_fixture_i_d_idx" ON "figure_versions" USING btree ("fixture_i_d");
  CREATE INDEX "figure_versions_prototype_idx" ON "figure_versions" USING btree ("prototype_id");
  CREATE INDEX "figure_versions_updated_at_idx" ON "figure_versions" USING btree ("updated_at");
  CREATE INDEX "figure_versions_created_at_idx" ON "figure_versions" USING btree ("created_at");
  CREATE INDEX "figure_versions_deleted_at_idx" ON "figure_versions" USING btree ("deleted_at");
  CREATE INDEX "_figure_versions_v_parent_idx" ON "_figure_versions_v" USING btree ("parent_id");
  CREATE INDEX "_figure_versions_v_version_version_fixture_i_d_idx" ON "_figure_versions_v" USING btree ("version_fixture_i_d");
  CREATE INDEX "_figure_versions_v_version_version_prototype_idx" ON "_figure_versions_v" USING btree ("version_prototype_id");
  CREATE INDEX "_figure_versions_v_version_version_updated_at_idx" ON "_figure_versions_v" USING btree ("version_updated_at");
  CREATE INDEX "_figure_versions_v_version_version_created_at_idx" ON "_figure_versions_v" USING btree ("version_created_at");
  CREATE INDEX "_figure_versions_v_version_version_deleted_at_idx" ON "_figure_versions_v" USING btree ("version_deleted_at");
  CREATE INDEX "_figure_versions_v_created_at_idx" ON "_figure_versions_v" USING btree ("created_at");
  CREATE INDEX "_figure_versions_v_updated_at_idx" ON "_figure_versions_v" USING btree ("updated_at");
  CREATE UNIQUE INDEX "source_records_fixture_i_d_idx" ON "source_records" USING btree ("fixture_i_d");
  CREATE INDEX "source_records_candidate_owner_idx" ON "source_records" USING btree ("candidate_owner_id");
  CREATE INDEX "source_records_source_type_idx" ON "source_records" USING btree ("source_type");
  CREATE INDEX "source_records_source_item_id_idx" ON "source_records" USING btree ("source_item_id");
  CREATE INDEX "source_records_canonical_url_idx" ON "source_records" USING btree ("canonical_url");
  CREATE UNIQUE INDEX "source_records_source_key_idx" ON "source_records" USING btree ("source_key");
  CREATE INDEX "source_records_prototype_idx" ON "source_records" USING btree ("prototype_id");
  CREATE INDEX "source_records_updated_at_idx" ON "source_records" USING btree ("updated_at");
  CREATE INDEX "source_records_created_at_idx" ON "source_records" USING btree ("created_at");
  CREATE INDEX "source_records_deleted_at_idx" ON "source_records" USING btree ("deleted_at");
  CREATE UNIQUE INDEX "candidate_records_external_key_idx" ON "candidate_records" USING btree ("external_key");
  CREATE INDEX "candidate_records_candidate_owner_idx" ON "candidate_records" USING btree ("candidate_owner_id");
  CREATE UNIQUE INDEX "candidate_records_source_idx" ON "candidate_records" USING btree ("source_id");
  CREATE INDEX "candidate_records_target_prototype_idx" ON "candidate_records" USING btree ("target_prototype_id");
  CREATE INDEX "candidate_records_target_version_idx" ON "candidate_records" USING btree ("target_version_id");
  CREATE INDEX "candidate_records_updated_at_idx" ON "candidate_records" USING btree ("updated_at");
  CREATE INDEX "candidate_records_created_at_idx" ON "candidate_records" USING btree ("created_at");
  CREATE INDEX "candidate_records_deleted_at_idx" ON "candidate_records" USING btree ("deleted_at");
  CREATE INDEX "candidate_records_texts_order_parent" ON "candidate_records_texts" USING btree ("order","parent_id");
  CREATE INDEX "candidate_records_rels_order_idx" ON "candidate_records_rels" USING btree ("order");
  CREATE INDEX "candidate_records_rels_parent_idx" ON "candidate_records_rels" USING btree ("parent_id");
  CREATE INDEX "candidate_records_rels_path_idx" ON "candidate_records_rels" USING btree ("path");
  CREATE INDEX "candidate_records_rels_media_id_idx" ON "candidate_records_rels" USING btree ("media_id");
  CREATE INDEX "_candidate_records_v_parent_idx" ON "_candidate_records_v" USING btree ("parent_id");
  CREATE INDEX "_candidate_records_v_version_version_external_key_idx" ON "_candidate_records_v" USING btree ("version_external_key");
  CREATE INDEX "_candidate_records_v_version_version_candidate_owner_idx" ON "_candidate_records_v" USING btree ("version_candidate_owner_id");
  CREATE INDEX "_candidate_records_v_version_version_source_idx" ON "_candidate_records_v" USING btree ("version_source_id");
  CREATE INDEX "_candidate_records_v_version_version_target_prototype_idx" ON "_candidate_records_v" USING btree ("version_target_prototype_id");
  CREATE INDEX "_candidate_records_v_version_version_target_version_idx" ON "_candidate_records_v" USING btree ("version_target_version_id");
  CREATE INDEX "_candidate_records_v_version_version_updated_at_idx" ON "_candidate_records_v" USING btree ("version_updated_at");
  CREATE INDEX "_candidate_records_v_version_version_created_at_idx" ON "_candidate_records_v" USING btree ("version_created_at");
  CREATE INDEX "_candidate_records_v_version_version_deleted_at_idx" ON "_candidate_records_v" USING btree ("version_deleted_at");
  CREATE INDEX "_candidate_records_v_created_at_idx" ON "_candidate_records_v" USING btree ("created_at");
  CREATE INDEX "_candidate_records_v_updated_at_idx" ON "_candidate_records_v" USING btree ("updated_at");
  CREATE INDEX "_candidate_records_v_texts_order_parent" ON "_candidate_records_v_texts" USING btree ("order","parent_id");
  CREATE INDEX "_candidate_records_v_rels_order_idx" ON "_candidate_records_v_rels" USING btree ("order");
  CREATE INDEX "_candidate_records_v_rels_parent_idx" ON "_candidate_records_v_rels" USING btree ("parent_id");
  CREATE INDEX "_candidate_records_v_rels_path_idx" ON "_candidate_records_v_rels" USING btree ("path");
  CREATE INDEX "_candidate_records_v_rels_media_id_idx" ON "_candidate_records_v_rels" USING btree ("media_id");
  CREATE INDEX "review_work_items_candidate_idx" ON "review_work_items" USING btree ("candidate_id");
  CREATE INDEX "review_work_items_reviewer_idx" ON "review_work_items" USING btree ("reviewer_id");
  CREATE INDEX "review_work_items_updated_at_idx" ON "review_work_items" USING btree ("updated_at");
  CREATE INDEX "review_work_items_created_at_idx" ON "review_work_items" USING btree ("created_at");
  CREATE INDEX "review_work_items_deleted_at_idx" ON "review_work_items" USING btree ("deleted_at");
  CREATE INDEX "review_work_items_rels_order_idx" ON "review_work_items_rels" USING btree ("order");
  CREATE INDEX "review_work_items_rels_parent_idx" ON "review_work_items_rels" USING btree ("parent_id");
  CREATE INDEX "review_work_items_rels_path_idx" ON "review_work_items_rels" USING btree ("path");
  CREATE INDEX "review_work_items_rels_figure_prototypes_id_idx" ON "review_work_items_rels" USING btree ("figure_prototypes_id");
  CREATE UNIQUE INDEX "operation_logs_fixture_i_d_idx" ON "operation_logs" USING btree ("fixture_i_d");
  CREATE UNIQUE INDEX "operation_logs_operation_i_d_idx" ON "operation_logs" USING btree ("operation_i_d");
  CREATE INDEX "operation_logs_actor_idx" ON "operation_logs" USING btree ("actor_id");
  CREATE INDEX "operation_logs_updated_at_idx" ON "operation_logs" USING btree ("updated_at");
  CREATE INDEX "operation_logs_created_at_idx" ON "operation_logs" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_works_id_idx" ON "payload_locked_documents_rels" USING btree ("works_id");
  CREATE INDEX "payload_locked_documents_rels_characters_id_idx" ON "payload_locked_documents_rels" USING btree ("characters_id");
  CREATE INDEX "payload_locked_documents_rels_manufacturers_id_idx" ON "payload_locked_documents_rels" USING btree ("manufacturers_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_figure_prototypes_id_idx" ON "payload_locked_documents_rels" USING btree ("figure_prototypes_id");
  CREATE INDEX "payload_locked_documents_rels_figure_versions_id_idx" ON "payload_locked_documents_rels" USING btree ("figure_versions_id");
  CREATE INDEX "payload_locked_documents_rels_source_records_id_idx" ON "payload_locked_documents_rels" USING btree ("source_records_id");
  CREATE INDEX "payload_locked_documents_rels_candidate_records_id_idx" ON "payload_locked_documents_rels" USING btree ("candidate_records_id");
  CREATE INDEX "payload_locked_documents_rels_review_work_items_id_idx" ON "payload_locked_documents_rels" USING btree ("review_work_items_id");
  CREATE INDEX "payload_locked_documents_rels_operation_logs_id_idx" ON "payload_locked_documents_rels" USING btree ("operation_logs_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "works" CASCADE;
  DROP TABLE "works_texts" CASCADE;
  DROP TABLE "_works_v" CASCADE;
  DROP TABLE "_works_v_texts" CASCADE;
  DROP TABLE "characters" CASCADE;
  DROP TABLE "characters_texts" CASCADE;
  DROP TABLE "_characters_v" CASCADE;
  DROP TABLE "_characters_v_texts" CASCADE;
  DROP TABLE "manufacturers" CASCADE;
  DROP TABLE "manufacturers_texts" CASCADE;
  DROP TABLE "_manufacturers_v" CASCADE;
  DROP TABLE "_manufacturers_v_texts" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "figure_prototypes" CASCADE;
  DROP TABLE "figure_prototypes_rels" CASCADE;
  DROP TABLE "_figure_prototypes_v" CASCADE;
  DROP TABLE "_figure_prototypes_v_rels" CASCADE;
  DROP TABLE "figure_versions" CASCADE;
  DROP TABLE "_figure_versions_v" CASCADE;
  DROP TABLE "source_records" CASCADE;
  DROP TABLE "candidate_records" CASCADE;
  DROP TABLE "candidate_records_texts" CASCADE;
  DROP TABLE "candidate_records_rels" CASCADE;
  DROP TABLE "_candidate_records_v" CASCADE;
  DROP TABLE "_candidate_records_v_texts" CASCADE;
  DROP TABLE "_candidate_records_v_rels" CASCADE;
  DROP TABLE "review_work_items" CASCADE;
  DROP TABLE "review_work_items_rels" CASCADE;
  DROP TABLE "operation_logs" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TABLE "system_settings" CASCADE;
  DROP TYPE "public"."enum_users_role";
  DROP TYPE "public"."enum_works_status";
  DROP TYPE "public"."enum__works_v_version_status";
  DROP TYPE "public"."enum_characters_status";
  DROP TYPE "public"."enum_characters_domain_status";
  DROP TYPE "public"."enum__characters_v_version_status";
  DROP TYPE "public"."enum_manufacturers_status";
  DROP TYPE "public"."enum_manufacturers_domain_status";
  DROP TYPE "public"."enum__manufacturers_v_version_status";
  DROP TYPE "public"."enum_figure_prototypes_figure_type";
  DROP TYPE "public"."enum_figure_prototypes_publication_status";
  DROP TYPE "public"."enum_figure_prototypes_status";
  DROP TYPE "public"."enum__figure_prototypes_v_version_figure_type";
  DROP TYPE "public"."enum__figure_prototypes_v_version_publication_status";
  DROP TYPE "public"."enum__figure_prototypes_v_version_status";
  DROP TYPE "public"."enum_figure_versions_kind";
  DROP TYPE "public"."enum__figure_versions_v_version_kind";
  DROP TYPE "public"."enum_source_records_status";
  DROP TYPE "public"."enum_candidate_records_status";
  DROP TYPE "public"."enum_candidate_records_match_state";
  DROP TYPE "public"."enum_candidate_records_proposed_manufacturer_status";
  DROP TYPE "public"."enum__candidate_records_v_version_status";
  DROP TYPE "public"."enum__candidate_records_v_version_match_state";
  DROP TYPE "public"."enum__candidate_records_v_version_proposed_manufacturer_status";
  DROP TYPE "public"."enum_review_work_items_status";
  DROP TYPE "public"."enum_operation_logs_operation_type";`)
}
