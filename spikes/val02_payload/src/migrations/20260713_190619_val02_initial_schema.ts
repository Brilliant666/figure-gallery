import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`users_sessions\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`created_at\` text,
    \`expires_at\` text NOT NULL,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_sessions_order_idx\` ON \`users_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`users_sessions_parent_id_idx\` ON \`users_sessions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`users\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`role\` text DEFAULT 'candidate-client' NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`enable_a_p_i_key\` integer,
    \`api_key\` text,
    \`api_key_index\` text,
    \`email\` text NOT NULL,
    \`reset_password_token\` text,
    \`reset_password_expiration\` text,
    \`salt\` text,
    \`hash\` text,
    \`login_attempts\` numeric DEFAULT 0,
    \`lock_until\` text
  );
  `)
  await db.run(sql`CREATE INDEX \`users_updated_at_idx\` ON \`users\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`users_created_at_idx\` ON \`users\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_email_idx\` ON \`users\` (\`email\`);`)
  await db.run(sql`CREATE TABLE \`works\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`fixture_i_d\` text,
    \`name\` text,
    \`original_name\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`deleted_at\` text,
    \`_status\` text DEFAULT 'draft'
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`works_fixture_i_d_idx\` ON \`works\` (\`fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`works_updated_at_idx\` ON \`works\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`works_created_at_idx\` ON \`works\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`works_deleted_at_idx\` ON \`works\` (\`deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`works__status_idx\` ON \`works\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`works_texts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`text\` text,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`works_texts_order_parent\` ON \`works_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`_works_v\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`parent_id\` integer,
    \`version_fixture_i_d\` text,
    \`version_name\` text,
    \`version_original_name\` text,
    \`version_updated_at\` text,
    \`version_created_at\` text,
    \`version_deleted_at\` text,
    \`version__status\` text DEFAULT 'draft',
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`latest\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_works_v_parent_idx\` ON \`_works_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_works_v_version_version_fixture_i_d_idx\` ON \`_works_v\` (\`version_fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`_works_v_version_version_updated_at_idx\` ON \`_works_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_works_v_version_version_created_at_idx\` ON \`_works_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_works_v_version_version_deleted_at_idx\` ON \`_works_v\` (\`version_deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`_works_v_version_version__status_idx\` ON \`_works_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_works_v_created_at_idx\` ON \`_works_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_works_v_updated_at_idx\` ON \`_works_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_works_v_latest_idx\` ON \`_works_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`_works_v_texts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`text\` text,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`_works_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_works_v_texts_order_parent\` ON \`_works_v_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`characters\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`fixture_i_d\` text,
    \`display_name\` text,
    \`name_zh\` text,
    \`name_ja\` text,
    \`name_en\` text,
    \`work_id\` integer,
    \`status\` text DEFAULT 'active',
    \`soft_deleted\` integer DEFAULT false,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`deleted_at\` text,
    \`_status\` text DEFAULT 'draft',
    FOREIGN KEY (\`work_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`characters_fixture_i_d_idx\` ON \`characters\` (\`fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`characters_display_name_idx\` ON \`characters\` (\`display_name\`);`)
  await db.run(sql`CREATE INDEX \`characters_name_zh_idx\` ON \`characters\` (\`name_zh\`);`)
  await db.run(sql`CREATE INDEX \`characters_name_ja_idx\` ON \`characters\` (\`name_ja\`);`)
  await db.run(sql`CREATE INDEX \`characters_name_en_idx\` ON \`characters\` (\`name_en\`);`)
  await db.run(sql`CREATE INDEX \`characters_work_idx\` ON \`characters\` (\`work_id\`);`)
  await db.run(sql`CREATE INDEX \`characters_updated_at_idx\` ON \`characters\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`characters_created_at_idx\` ON \`characters\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`characters_deleted_at_idx\` ON \`characters\` (\`deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`characters__status_idx\` ON \`characters\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`characters_texts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`text\` text,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`characters\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`characters_texts_order_parent\` ON \`characters_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`characters_texts_text_idx\` ON \`characters_texts\` (\`text\`);`)
  await db.run(sql`CREATE TABLE \`_characters_v\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`parent_id\` integer,
    \`version_fixture_i_d\` text,
    \`version_display_name\` text,
    \`version_name_zh\` text,
    \`version_name_ja\` text,
    \`version_name_en\` text,
    \`version_work_id\` integer,
    \`version_status\` text DEFAULT 'active',
    \`version_soft_deleted\` integer DEFAULT false,
    \`version_updated_at\` text,
    \`version_created_at\` text,
    \`version_deleted_at\` text,
    \`version__status\` text DEFAULT 'draft',
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`latest\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`characters\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_work_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_characters_v_parent_idx\` ON \`_characters_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_version_version_fixture_i_d_idx\` ON \`_characters_v\` (\`version_fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_version_version_display_name_idx\` ON \`_characters_v\` (\`version_display_name\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_version_version_name_zh_idx\` ON \`_characters_v\` (\`version_name_zh\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_version_version_name_ja_idx\` ON \`_characters_v\` (\`version_name_ja\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_version_version_name_en_idx\` ON \`_characters_v\` (\`version_name_en\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_version_version_work_idx\` ON \`_characters_v\` (\`version_work_id\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_version_version_updated_at_idx\` ON \`_characters_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_version_version_created_at_idx\` ON \`_characters_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_version_version_deleted_at_idx\` ON \`_characters_v\` (\`version_deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_version_version__status_idx\` ON \`_characters_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_created_at_idx\` ON \`_characters_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_updated_at_idx\` ON \`_characters_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_characters_v_latest_idx\` ON \`_characters_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`_characters_v_texts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`text\` text,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`_characters_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_characters_v_texts_order_parent\` ON \`_characters_v_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`manufacturers\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`fixture_i_d\` text,
    \`canonical_name\` text,
    \`status\` text DEFAULT 'draft',
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`deleted_at\` text,
    \`_status\` text DEFAULT 'draft'
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`manufacturers_fixture_i_d_idx\` ON \`manufacturers\` (\`fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`manufacturers_canonical_name_idx\` ON \`manufacturers\` (\`canonical_name\`);`)
  await db.run(sql`CREATE INDEX \`manufacturers_updated_at_idx\` ON \`manufacturers\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`manufacturers_created_at_idx\` ON \`manufacturers\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`manufacturers_deleted_at_idx\` ON \`manufacturers\` (\`deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`manufacturers__status_idx\` ON \`manufacturers\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`manufacturers_texts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`text\` text,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`manufacturers\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`manufacturers_texts_order_parent\` ON \`manufacturers_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`_manufacturers_v\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`parent_id\` integer,
    \`version_fixture_i_d\` text,
    \`version_canonical_name\` text,
    \`version_status\` text DEFAULT 'draft',
    \`version_updated_at\` text,
    \`version_created_at\` text,
    \`version_deleted_at\` text,
    \`version__status\` text DEFAULT 'draft',
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`latest\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`manufacturers\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_parent_idx\` ON \`_manufacturers_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_version_version_fixture_i_d_idx\` ON \`_manufacturers_v\` (\`version_fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_version_version_canonical_name_idx\` ON \`_manufacturers_v\` (\`version_canonical_name\`);`)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_version_version_updated_at_idx\` ON \`_manufacturers_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_version_version_created_at_idx\` ON \`_manufacturers_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_version_version_deleted_at_idx\` ON \`_manufacturers_v\` (\`version_deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_version_version__status_idx\` ON \`_manufacturers_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_created_at_idx\` ON \`_manufacturers_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_updated_at_idx\` ON \`_manufacturers_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_latest_idx\` ON \`_manufacturers_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`_manufacturers_v_texts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`text\` text,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`_manufacturers_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_manufacturers_v_texts_order_parent\` ON \`_manufacturers_v_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`media\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`fixture_i_d\` text,
    \`candidate_only\` integer DEFAULT true NOT NULL,
    \`candidate_id\` integer,
    \`prototype_id\` integer,
    \`source_url\` text NOT NULL,
    \`storage_key\` text NOT NULL,
    \`byte_size\` numeric,
    \`pixel_width\` numeric,
    \`pixel_height\` numeric,
    \`format\` text,
    \`sha256\` text NOT NULL,
    \`perceptual_hash\` text,
    \`is_adult\` integer DEFAULT false NOT NULL,
    \`is_source_homepage\` integer DEFAULT false NOT NULL,
    \`present_in_latest_source\` integer DEFAULT true NOT NULL,
    \`selected_as_main\` integer DEFAULT false NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`deleted_at\` text,
    \`url\` text,
    \`thumbnail_u_r_l\` text,
    \`filename\` text,
    \`mime_type\` text,
    \`filesize\` numeric,
    \`width\` numeric,
    \`height\` numeric,
    \`focal_x\` numeric,
    \`focal_y\` numeric,
    \`sizes_thumbnail_url\` text,
    \`sizes_thumbnail_width\` numeric,
    \`sizes_thumbnail_height\` numeric,
    \`sizes_thumbnail_mime_type\` text,
    \`sizes_thumbnail_filesize\` numeric,
    \`sizes_thumbnail_filename\` text,
    \`sizes_preview_url\` text,
    \`sizes_preview_width\` numeric,
    \`sizes_preview_height\` numeric,
    \`sizes_preview_mime_type\` text,
    \`sizes_preview_filesize\` numeric,
    \`sizes_preview_filename\` text,
    FOREIGN KEY (\`candidate_id\`) REFERENCES \`candidate_records\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`prototype_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`media_fixture_i_d_idx\` ON \`media\` (\`fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`media_candidate_idx\` ON \`media\` (\`candidate_id\`);`)
  await db.run(sql`CREATE INDEX \`media_prototype_idx\` ON \`media\` (\`prototype_id\`);`)
  await db.run(sql`CREATE INDEX \`media_storage_key_idx\` ON \`media\` (\`storage_key\`);`)
  await db.run(sql`CREATE INDEX \`media_sha256_idx\` ON \`media\` (\`sha256\`);`)
  await db.run(sql`CREATE INDEX \`media_updated_at_idx\` ON \`media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`media_created_at_idx\` ON \`media\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`media_deleted_at_idx\` ON \`media\` (\`deleted_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_filename_idx\` ON \`media\` (\`filename\`);`)
  await db.run(sql`CREATE INDEX \`media_sizes_thumbnail_sizes_thumbnail_filename_idx\` ON \`media\` (\`sizes_thumbnail_filename\`);`)
  await db.run(sql`CREATE INDEX \`media_sizes_preview_sizes_preview_filename_idx\` ON \`media\` (\`sizes_preview_filename\`);`)
  await db.run(sql`CREATE TABLE \`figure_prototypes\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`fixture_i_d\` text,
    \`title\` text,
    \`work_id\` integer,
    \`manufacturer_id\` integer,
    \`figure_type\` text,
    \`scale\` text,
    \`costume_text\` text,
    \`is_group\` integer DEFAULT false,
    \`is_adult\` integer DEFAULT false,
    \`publication_status\` text DEFAULT 'draft',
    \`soft_deleted\` integer DEFAULT false,
    \`main_image_id\` integer,
    \`merged_into_id\` integer,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`deleted_at\` text,
    \`_status\` text DEFAULT 'draft',
    FOREIGN KEY (\`work_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`manufacturer_id\`) REFERENCES \`manufacturers\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`main_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`merged_into_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`figure_prototypes_fixture_i_d_idx\` ON \`figure_prototypes\` (\`fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes_work_idx\` ON \`figure_prototypes\` (\`work_id\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes_manufacturer_idx\` ON \`figure_prototypes\` (\`manufacturer_id\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes_main_image_idx\` ON \`figure_prototypes\` (\`main_image_id\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes_merged_into_idx\` ON \`figure_prototypes\` (\`merged_into_id\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes_updated_at_idx\` ON \`figure_prototypes\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes_created_at_idx\` ON \`figure_prototypes\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes_deleted_at_idx\` ON \`figure_prototypes\` (\`deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes__status_idx\` ON \`figure_prototypes\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`figure_prototypes_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`characters_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`characters_id\`) REFERENCES \`characters\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`figure_prototypes_rels_order_idx\` ON \`figure_prototypes_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes_rels_parent_idx\` ON \`figure_prototypes_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes_rels_path_idx\` ON \`figure_prototypes_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`figure_prototypes_rels_characters_id_idx\` ON \`figure_prototypes_rels\` (\`characters_id\`);`)
  await db.run(sql`CREATE TABLE \`_figure_prototypes_v\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`parent_id\` integer,
    \`version_fixture_i_d\` text,
    \`version_title\` text,
    \`version_work_id\` integer,
    \`version_manufacturer_id\` integer,
    \`version_figure_type\` text,
    \`version_scale\` text,
    \`version_costume_text\` text,
    \`version_is_group\` integer DEFAULT false,
    \`version_is_adult\` integer DEFAULT false,
    \`version_publication_status\` text DEFAULT 'draft',
    \`version_soft_deleted\` integer DEFAULT false,
    \`version_main_image_id\` integer,
    \`version_merged_into_id\` integer,
    \`version_updated_at\` text,
    \`version_created_at\` text,
    \`version_deleted_at\` text,
    \`version__status\` text DEFAULT 'draft',
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`latest\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_work_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_manufacturer_id\`) REFERENCES \`manufacturers\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_main_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_merged_into_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_parent_idx\` ON \`_figure_prototypes_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_version_version_fixture_i_d_idx\` ON \`_figure_prototypes_v\` (\`version_fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_version_version_work_idx\` ON \`_figure_prototypes_v\` (\`version_work_id\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_version_version_manufacturer_idx\` ON \`_figure_prototypes_v\` (\`version_manufacturer_id\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_version_version_main_image_idx\` ON \`_figure_prototypes_v\` (\`version_main_image_id\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_version_version_merged_into_idx\` ON \`_figure_prototypes_v\` (\`version_merged_into_id\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_version_version_updated_at_idx\` ON \`_figure_prototypes_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_version_version_created_at_idx\` ON \`_figure_prototypes_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_version_version_deleted_at_idx\` ON \`_figure_prototypes_v\` (\`version_deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_version_version__status_idx\` ON \`_figure_prototypes_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_created_at_idx\` ON \`_figure_prototypes_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_updated_at_idx\` ON \`_figure_prototypes_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_latest_idx\` ON \`_figure_prototypes_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`_figure_prototypes_v_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`characters_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`_figure_prototypes_v\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`characters_id\`) REFERENCES \`characters\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_rels_order_idx\` ON \`_figure_prototypes_v_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_rels_parent_idx\` ON \`_figure_prototypes_v_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_rels_path_idx\` ON \`_figure_prototypes_v_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`_figure_prototypes_v_rels_characters_id_idx\` ON \`_figure_prototypes_v_rels\` (\`characters_id\`);`)
  await db.run(sql`CREATE TABLE \`figure_versions\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`fixture_i_d\` text,
    \`prototype_id\` integer NOT NULL,
    \`name\` text NOT NULL,
    \`kind\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`deleted_at\` text,
    FOREIGN KEY (\`prototype_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`figure_versions_fixture_i_d_idx\` ON \`figure_versions\` (\`fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`figure_versions_prototype_idx\` ON \`figure_versions\` (\`prototype_id\`);`)
  await db.run(sql`CREATE INDEX \`figure_versions_updated_at_idx\` ON \`figure_versions\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`figure_versions_created_at_idx\` ON \`figure_versions\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`figure_versions_deleted_at_idx\` ON \`figure_versions\` (\`deleted_at\`);`)
  await db.run(sql`CREATE TABLE \`_figure_versions_v\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`parent_id\` integer,
    \`version_fixture_i_d\` text,
    \`version_prototype_id\` integer NOT NULL,
    \`version_name\` text NOT NULL,
    \`version_kind\` text NOT NULL,
    \`version_updated_at\` text,
    \`version_created_at\` text,
    \`version_deleted_at\` text,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`figure_versions\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_prototype_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_figure_versions_v_parent_idx\` ON \`_figure_versions_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_figure_versions_v_version_version_fixture_i_d_idx\` ON \`_figure_versions_v\` (\`version_fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`_figure_versions_v_version_version_prototype_idx\` ON \`_figure_versions_v\` (\`version_prototype_id\`);`)
  await db.run(sql`CREATE INDEX \`_figure_versions_v_version_version_updated_at_idx\` ON \`_figure_versions_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_figure_versions_v_version_version_created_at_idx\` ON \`_figure_versions_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_figure_versions_v_version_version_deleted_at_idx\` ON \`_figure_versions_v\` (\`version_deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`_figure_versions_v_created_at_idx\` ON \`_figure_versions_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_figure_versions_v_updated_at_idx\` ON \`_figure_versions_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE TABLE \`source_records\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`fixture_i_d\` text,
    \`candidate_only\` integer DEFAULT true NOT NULL,
    \`candidate_owner_id\` integer,
    \`source_type\` text NOT NULL,
    \`source_item_id\` text,
    \`source_url\` text NOT NULL,
    \`canonical_url\` text NOT NULL,
    \`source_key\` text NOT NULL,
    \`status\` text NOT NULL,
    \`last_synced_at\` text,
    \`invalidated\` integer DEFAULT false NOT NULL,
    \`raw_snapshot\` text NOT NULL,
    \`prototype_id\` integer,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`deleted_at\` text,
    FOREIGN KEY (\`candidate_owner_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`prototype_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`source_records_fixture_i_d_idx\` ON \`source_records\` (\`fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`source_records_candidate_owner_idx\` ON \`source_records\` (\`candidate_owner_id\`);`)
  await db.run(sql`CREATE INDEX \`source_records_source_type_idx\` ON \`source_records\` (\`source_type\`);`)
  await db.run(sql`CREATE INDEX \`source_records_source_item_id_idx\` ON \`source_records\` (\`source_item_id\`);`)
  await db.run(sql`CREATE INDEX \`source_records_canonical_url_idx\` ON \`source_records\` (\`canonical_url\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`source_records_source_key_idx\` ON \`source_records\` (\`source_key\`);`)
  await db.run(sql`CREATE INDEX \`source_records_prototype_idx\` ON \`source_records\` (\`prototype_id\`);`)
  await db.run(sql`CREATE INDEX \`source_records_updated_at_idx\` ON \`source_records\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`source_records_created_at_idx\` ON \`source_records\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`source_records_deleted_at_idx\` ON \`source_records\` (\`deleted_at\`);`)
  await db.run(sql`CREATE TABLE \`candidate_records\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`external_key\` text NOT NULL,
    \`source_id\` integer NOT NULL,
    \`raw_title\` text NOT NULL,
    \`raw_work_name\` text,
    \`raw_manufacturer\` text,
    \`raw_category\` text,
    \`raw_scale\` text,
    \`raw_date\` text,
    \`raw_snapshot\` text NOT NULL,
    \`status\` text DEFAULT 'pending' NOT NULL,
    \`reason\` text,
    \`match_state\` text DEFAULT 'character_pending' NOT NULL,
    \`proposed_manufacturer_status\` text,
    \`requested_changes\` text,
    \`accepted_fields\` text,
    \`rejected_fields\` text,
    \`target_prototype_id\` integer,
    \`target_version_id\` integer,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`deleted_at\` text,
    FOREIGN KEY (\`source_id\`) REFERENCES \`source_records\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`target_prototype_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`target_version_id\`) REFERENCES \`figure_versions\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`candidate_records_external_key_idx\` ON \`candidate_records\` (\`external_key\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`candidate_records_source_idx\` ON \`candidate_records\` (\`source_id\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_target_prototype_idx\` ON \`candidate_records\` (\`target_prototype_id\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_target_version_idx\` ON \`candidate_records\` (\`target_version_id\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_updated_at_idx\` ON \`candidate_records\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_created_at_idx\` ON \`candidate_records\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_deleted_at_idx\` ON \`candidate_records\` (\`deleted_at\`);`)
  await db.run(sql`CREATE TABLE \`candidate_records_texts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`text\` text,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`candidate_records\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`candidate_records_texts_order_parent\` ON \`candidate_records_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`candidate_records_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`media_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`candidate_records\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`candidate_records_rels_order_idx\` ON \`candidate_records_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_rels_parent_idx\` ON \`candidate_records_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_rels_path_idx\` ON \`candidate_records_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_rels_media_id_idx\` ON \`candidate_records_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE TABLE \`_candidate_records_v\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`parent_id\` integer,
    \`version_external_key\` text NOT NULL,
    \`version_source_id\` integer NOT NULL,
    \`version_raw_title\` text NOT NULL,
    \`version_raw_work_name\` text,
    \`version_raw_manufacturer\` text,
    \`version_raw_category\` text,
    \`version_raw_scale\` text,
    \`version_raw_date\` text,
    \`version_raw_snapshot\` text NOT NULL,
    \`version_status\` text DEFAULT 'pending' NOT NULL,
    \`version_reason\` text,
    \`version_match_state\` text DEFAULT 'character_pending' NOT NULL,
    \`version_proposed_manufacturer_status\` text,
    \`version_requested_changes\` text,
    \`version_accepted_fields\` text,
    \`version_rejected_fields\` text,
    \`version_target_prototype_id\` integer,
    \`version_target_version_id\` integer,
    \`version_updated_at\` text,
    \`version_created_at\` text,
    \`version_deleted_at\` text,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`candidate_records\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_source_id\`) REFERENCES \`source_records\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_target_prototype_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_target_version_id\`) REFERENCES \`figure_versions\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_parent_idx\` ON \`_candidate_records_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_version_version_external_key_idx\` ON \`_candidate_records_v\` (\`version_external_key\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_version_version_source_idx\` ON \`_candidate_records_v\` (\`version_source_id\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_version_version_target_prototype_idx\` ON \`_candidate_records_v\` (\`version_target_prototype_id\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_version_version_target_version_idx\` ON \`_candidate_records_v\` (\`version_target_version_id\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_version_version_updated_at_idx\` ON \`_candidate_records_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_version_version_created_at_idx\` ON \`_candidate_records_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_version_version_deleted_at_idx\` ON \`_candidate_records_v\` (\`version_deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_created_at_idx\` ON \`_candidate_records_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_updated_at_idx\` ON \`_candidate_records_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE TABLE \`_candidate_records_v_texts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`text\` text,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`_candidate_records_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_texts_order_parent\` ON \`_candidate_records_v_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`_candidate_records_v_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`media_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`_candidate_records_v\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_rels_order_idx\` ON \`_candidate_records_v_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_rels_parent_idx\` ON \`_candidate_records_v_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_rels_path_idx\` ON \`_candidate_records_v_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_rels_media_id_idx\` ON \`_candidate_records_v_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE TABLE \`operation_logs\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`fixture_i_d\` text,
    \`actor_id\` integer,
    \`actor_label\` text NOT NULL,
    \`operation_type\` text NOT NULL,
    \`reason\` text NOT NULL,
    \`before_state\` text NOT NULL,
    \`after_state\` text NOT NULL,
    \`related_records\` text NOT NULL,
    \`inverse_payload\` text,
    \`undone\` integer DEFAULT false NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`actor_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`operation_logs_fixture_i_d_idx\` ON \`operation_logs\` (\`fixture_i_d\`);`)
  await db.run(sql`CREATE INDEX \`operation_logs_actor_idx\` ON \`operation_logs\` (\`actor_id\`);`)
  await db.run(sql`CREATE INDEX \`operation_logs_updated_at_idx\` ON \`operation_logs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`operation_logs_created_at_idx\` ON \`operation_logs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_kv\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`data\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`global_slug\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_global_slug_idx\` ON \`payload_locked_documents\` (\`global_slug\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_updated_at_idx\` ON \`payload_locked_documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_created_at_idx\` ON \`payload_locked_documents\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`users_id\` integer,
    \`works_id\` integer,
    \`characters_id\` integer,
    \`manufacturers_id\` integer,
    \`media_id\` integer,
    \`figure_prototypes_id\` integer,
    \`figure_versions_id\` integer,
    \`source_records_id\` integer,
    \`candidate_records_id\` integer,
    \`operation_logs_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`works_id\`) REFERENCES \`works\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`characters_id\`) REFERENCES \`characters\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`manufacturers_id\`) REFERENCES \`manufacturers\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`figure_prototypes_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`figure_versions_id\`) REFERENCES \`figure_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`source_records_id\`) REFERENCES \`source_records\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`candidate_records_id\`) REFERENCES \`candidate_records\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`operation_logs_id\`) REFERENCES \`operation_logs\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_works_id_idx\` ON \`payload_locked_documents_rels\` (\`works_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_characters_id_idx\` ON \`payload_locked_documents_rels\` (\`characters_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_manufacturers_id_idx\` ON \`payload_locked_documents_rels\` (\`manufacturers_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_figure_prototypes_id_idx\` ON \`payload_locked_documents_rels\` (\`figure_prototypes_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_figure_versions_id_idx\` ON \`payload_locked_documents_rels\` (\`figure_versions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_source_records_id_idx\` ON \`payload_locked_documents_rels\` (\`source_records_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_candidate_records_id_idx\` ON \`payload_locked_documents_rels\` (\`candidate_records_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_operation_logs_id_idx\` ON \`payload_locked_documents_rels\` (\`operation_logs_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`key\` text,
    \`value\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_key_idx\` ON \`payload_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_updated_at_idx\` ON \`payload_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_created_at_idx\` ON \`payload_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`users_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_order_idx\` ON \`payload_preferences_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_parent_idx\` ON \`payload_preferences_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_path_idx\` ON \`payload_preferences_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_users_id_idx\` ON \`payload_preferences_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_migrations\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`name\` text,
    \`batch\` numeric,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_migrations_updated_at_idx\` ON \`payload_migrations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_migrations_created_at_idx\` ON \`payload_migrations\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`system_settings\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`show_adult_images\` integer DEFAULT false NOT NULL,
    \`gallery_page_size\` numeric DEFAULT 16 NOT NULL,
    \`public_read_enabled\` integer DEFAULT true NOT NULL,
    \`updated_at\` text,
    \`created_at\` text
  );
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`users_sessions\`;`)
  await db.run(sql`DROP TABLE \`users\`;`)
  await db.run(sql`DROP TABLE \`works\`;`)
  await db.run(sql`DROP TABLE \`works_texts\`;`)
  await db.run(sql`DROP TABLE \`_works_v\`;`)
  await db.run(sql`DROP TABLE \`_works_v_texts\`;`)
  await db.run(sql`DROP TABLE \`characters\`;`)
  await db.run(sql`DROP TABLE \`characters_texts\`;`)
  await db.run(sql`DROP TABLE \`_characters_v\`;`)
  await db.run(sql`DROP TABLE \`_characters_v_texts\`;`)
  await db.run(sql`DROP TABLE \`manufacturers\`;`)
  await db.run(sql`DROP TABLE \`manufacturers_texts\`;`)
  await db.run(sql`DROP TABLE \`_manufacturers_v\`;`)
  await db.run(sql`DROP TABLE \`_manufacturers_v_texts\`;`)
  await db.run(sql`DROP TABLE \`media\`;`)
  await db.run(sql`DROP TABLE \`figure_prototypes\`;`)
  await db.run(sql`DROP TABLE \`figure_prototypes_rels\`;`)
  await db.run(sql`DROP TABLE \`_figure_prototypes_v\`;`)
  await db.run(sql`DROP TABLE \`_figure_prototypes_v_rels\`;`)
  await db.run(sql`DROP TABLE \`figure_versions\`;`)
  await db.run(sql`DROP TABLE \`_figure_versions_v\`;`)
  await db.run(sql`DROP TABLE \`source_records\`;`)
  await db.run(sql`DROP TABLE \`candidate_records\`;`)
  await db.run(sql`DROP TABLE \`candidate_records_texts\`;`)
  await db.run(sql`DROP TABLE \`candidate_records_rels\`;`)
  await db.run(sql`DROP TABLE \`_candidate_records_v\`;`)
  await db.run(sql`DROP TABLE \`_candidate_records_v_texts\`;`)
  await db.run(sql`DROP TABLE \`_candidate_records_v_rels\`;`)
  await db.run(sql`DROP TABLE \`operation_logs\`;`)
  await db.run(sql`DROP TABLE \`payload_kv\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_migrations\`;`)
  await db.run(sql`DROP TABLE \`system_settings\`;`)
}
