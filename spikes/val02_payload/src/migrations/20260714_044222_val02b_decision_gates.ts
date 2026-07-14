import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`review_work_items\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`candidate_id\` integer NOT NULL,
	\`reviewer_id\` integer NOT NULL,
	\`status\` text DEFAULT 'open' NOT NULL,
	\`lock_version\` numeric DEFAULT 1 NOT NULL,
	\`started_at\` text NOT NULL,
	\`completed_at\` text,
	\`decision_reason\` text,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`deleted_at\` text,
	FOREIGN KEY (\`candidate_id\`) REFERENCES \`candidate_records\`(\`id\`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (\`reviewer_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`review_work_items_candidate_idx\` ON \`review_work_items\` (\`candidate_id\`);`)
  await db.run(sql`CREATE INDEX \`review_work_items_reviewer_idx\` ON \`review_work_items\` (\`reviewer_id\`);`)
  await db.run(sql`CREATE INDEX \`review_work_items_updated_at_idx\` ON \`review_work_items\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`review_work_items_created_at_idx\` ON \`review_work_items\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`review_work_items_deleted_at_idx\` ON \`review_work_items\` (\`deleted_at\`);`)
  await db.run(sql`CREATE TABLE \`review_work_items_rels\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`order\` integer,
	\`parent_id\` integer NOT NULL,
	\`path\` text NOT NULL,
	\`figure_prototypes_id\` integer,
	FOREIGN KEY (\`parent_id\`) REFERENCES \`review_work_items\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`figure_prototypes_id\`) REFERENCES \`figure_prototypes\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`review_work_items_rels_order_idx\` ON \`review_work_items_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`review_work_items_rels_parent_idx\` ON \`review_work_items_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`review_work_items_rels_path_idx\` ON \`review_work_items_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`review_work_items_rels_figure_prototypes_id_idx\` ON \`review_work_items_rels\` (\`figure_prototypes_id\`);`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`candidate_client_i_d\` text;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`candidate_active\` integer DEFAULT true NOT NULL;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`candidate_token_hash\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_candidate_client_i_d_idx\` ON \`users\` (\`candidate_client_i_d\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_candidate_token_hash_idx\` ON \`users\` (\`candidate_token_hash\`);`)
  await db.run(sql`ALTER TABLE \`media\` ADD \`candidate_owner_id\` integer REFERENCES users(id);`)
  await db.run(sql`ALTER TABLE \`media\` ADD \`client_candidate_i_d\` text;`)
  await db.run(sql`ALTER TABLE \`media\` ADD \`idempotency_key\` text;`)
  await db.run(sql`CREATE INDEX \`media_candidate_owner_idx\` ON \`media\` (\`candidate_owner_id\`);`)
  await db.run(sql`CREATE INDEX \`media_client_candidate_i_d_idx\` ON \`media\` (\`client_candidate_i_d\`);`)
  await db.run(sql`CREATE INDEX \`media_idempotency_key_idx\` ON \`media\` (\`idempotency_key\`);`)
  await db.run(sql`ALTER TABLE \`figure_prototypes\` ADD \`lock_version\` numeric DEFAULT 1;`)
  await db.run(sql`ALTER TABLE \`_figure_prototypes_v\` ADD \`version_lock_version\` numeric DEFAULT 1;`)
  await db.run(sql`ALTER TABLE \`candidate_records\` ADD \`candidate_owner_id\` integer REFERENCES users(id);`)
  await db.run(sql`CREATE INDEX \`candidate_records_candidate_owner_idx\` ON \`candidate_records\` (\`candidate_owner_id\`);`)
  await db.run(sql`ALTER TABLE \`_candidate_records_v\` ADD \`version_candidate_owner_id\` integer REFERENCES users(id);`)
  await db.run(sql`CREATE INDEX \`_candidate_records_v_version_version_candidate_owner_idx\` ON \`_candidate_records_v\` (\`version_candidate_owner_id\`);`)
  await db.run(sql`ALTER TABLE \`operation_logs\` ADD \`operation_i_d\` text;`)
  await db.run(sql`ALTER TABLE \`operation_logs\` ADD \`operation_version\` numeric DEFAULT 1 NOT NULL;`)
  await db.run(sql`ALTER TABLE \`operation_logs\` ADD \`scope\` text;`)
  await db.run(sql`ALTER TABLE \`operation_logs\` ADD \`depends_on\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`operation_logs_operation_i_d_idx\` ON \`operation_logs\` (\`operation_i_d\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`review_work_items_id\` integer REFERENCES review_work_items(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_review_work_items_id_idx\` ON \`payload_locked_documents_rels\` (\`review_work_items_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`review_work_items\`;`)
  await db.run(sql`DROP TABLE \`review_work_items_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_media\` (
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
  await db.run(sql`INSERT INTO \`__new_media\`("id", "fixture_i_d", "candidate_only", "candidate_id", "prototype_id", "source_url", "storage_key", "byte_size", "pixel_width", "pixel_height", "format", "sha256", "perceptual_hash", "is_adult", "is_source_homepage", "present_in_latest_source", "selected_as_main", "updated_at", "created_at", "deleted_at", "url", "thumbnail_u_r_l", "filename", "mime_type", "filesize", "width", "height", "focal_x", "focal_y", "sizes_thumbnail_url", "sizes_thumbnail_width", "sizes_thumbnail_height", "sizes_thumbnail_mime_type", "sizes_thumbnail_filesize", "sizes_thumbnail_filename", "sizes_preview_url", "sizes_preview_width", "sizes_preview_height", "sizes_preview_mime_type", "sizes_preview_filesize", "sizes_preview_filename") SELECT "id", "fixture_i_d", "candidate_only", "candidate_id", "prototype_id", "source_url", "storage_key", "byte_size", "pixel_width", "pixel_height", "format", "sha256", "perceptual_hash", "is_adult", "is_source_homepage", "present_in_latest_source", "selected_as_main", "updated_at", "created_at", "deleted_at", "url", "thumbnail_u_r_l", "filename", "mime_type", "filesize", "width", "height", "focal_x", "focal_y", "sizes_thumbnail_url", "sizes_thumbnail_width", "sizes_thumbnail_height", "sizes_thumbnail_mime_type", "sizes_thumbnail_filesize", "sizes_thumbnail_filename", "sizes_preview_url", "sizes_preview_width", "sizes_preview_height", "sizes_preview_mime_type", "sizes_preview_filesize", "sizes_preview_filename" FROM \`media\`;`)
  await db.run(sql`DROP TABLE \`media\`;`)
  await db.run(sql`ALTER TABLE \`__new_media\` RENAME TO \`media\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
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
  await db.run(sql`CREATE TABLE \`__new_candidate_records\` (
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
  await db.run(sql`INSERT INTO \`__new_candidate_records\`("id", "external_key", "source_id", "raw_title", "raw_work_name", "raw_manufacturer", "raw_category", "raw_scale", "raw_date", "raw_snapshot", "status", "reason", "match_state", "proposed_manufacturer_status", "requested_changes", "accepted_fields", "rejected_fields", "target_prototype_id", "target_version_id", "updated_at", "created_at", "deleted_at") SELECT "id", "external_key", "source_id", "raw_title", "raw_work_name", "raw_manufacturer", "raw_category", "raw_scale", "raw_date", "raw_snapshot", "status", "reason", "match_state", "proposed_manufacturer_status", "requested_changes", "accepted_fields", "rejected_fields", "target_prototype_id", "target_version_id", "updated_at", "created_at", "deleted_at" FROM \`candidate_records\`;`)
  await db.run(sql`DROP TABLE \`candidate_records\`;`)
  await db.run(sql`ALTER TABLE \`__new_candidate_records\` RENAME TO \`candidate_records\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`candidate_records_external_key_idx\` ON \`candidate_records\` (\`external_key\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`candidate_records_source_idx\` ON \`candidate_records\` (\`source_id\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_target_prototype_idx\` ON \`candidate_records\` (\`target_prototype_id\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_target_version_idx\` ON \`candidate_records\` (\`target_version_id\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_updated_at_idx\` ON \`candidate_records\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_created_at_idx\` ON \`candidate_records\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`candidate_records_deleted_at_idx\` ON \`candidate_records\` (\`deleted_at\`);`)
  await db.run(sql`CREATE TABLE \`__new__candidate_records_v\` (
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
  await db.run(sql`INSERT INTO \`__new__candidate_records_v\`("id", "parent_id", "version_external_key", "version_source_id", "version_raw_title", "version_raw_work_name", "version_raw_manufacturer", "version_raw_category", "version_raw_scale", "version_raw_date", "version_raw_snapshot", "version_status", "version_reason", "version_match_state", "version_proposed_manufacturer_status", "version_requested_changes", "version_accepted_fields", "version_rejected_fields", "version_target_prototype_id", "version_target_version_id", "version_updated_at", "version_created_at", "version_deleted_at", "created_at", "updated_at") SELECT "id", "parent_id", "version_external_key", "version_source_id", "version_raw_title", "version_raw_work_name", "version_raw_manufacturer", "version_raw_category", "version_raw_scale", "version_raw_date", "version_raw_snapshot", "version_status", "version_reason", "version_match_state", "version_proposed_manufacturer_status", "version_requested_changes", "version_accepted_fields", "version_rejected_fields", "version_target_prototype_id", "version_target_version_id", "version_updated_at", "version_created_at", "version_deleted_at", "created_at", "updated_at" FROM \`_candidate_records_v\`;`)
  await db.run(sql`DROP TABLE \`_candidate_records_v\`;`)
  await db.run(sql`ALTER TABLE \`__new__candidate_records_v\` RENAME TO \`_candidate_records_v\`;`)
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
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
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
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "users_id", "works_id", "characters_id", "manufacturers_id", "media_id", "figure_prototypes_id", "figure_versions_id", "source_records_id", "candidate_records_id", "operation_logs_id") SELECT "id", "order", "parent_id", "path", "users_id", "works_id", "characters_id", "manufacturers_id", "media_id", "figure_prototypes_id", "figure_versions_id", "source_records_id", "candidate_records_id", "operation_logs_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
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
  await db.run(sql`DROP INDEX \`users_candidate_client_i_d_idx\`;`)
  await db.run(sql`DROP INDEX \`users_candidate_token_hash_idx\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`candidate_client_i_d\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`candidate_active\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`candidate_token_hash\`;`)
  await db.run(sql`DROP INDEX \`operation_logs_operation_i_d_idx\`;`)
  await db.run(sql`ALTER TABLE \`operation_logs\` DROP COLUMN \`operation_i_d\`;`)
  await db.run(sql`ALTER TABLE \`operation_logs\` DROP COLUMN \`operation_version\`;`)
  await db.run(sql`ALTER TABLE \`operation_logs\` DROP COLUMN \`scope\`;`)
  await db.run(sql`ALTER TABLE \`operation_logs\` DROP COLUMN \`depends_on\`;`)
  await db.run(sql`ALTER TABLE \`figure_prototypes\` DROP COLUMN \`lock_version\`;`)
  await db.run(sql`ALTER TABLE \`_figure_prototypes_v\` DROP COLUMN \`version_lock_version\`;`)
}
