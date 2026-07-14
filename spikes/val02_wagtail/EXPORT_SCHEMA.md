# Open export field guide

The JSON export is one document with the tables below. CSV export writes the
same list-valued tables as separate UTF-8 CSV files plus `manifest.json`.
Framework-private backups and media bytes are intentionally excluded.

| Table | Stable / relationship fields | Important portable metadata |
| --- | --- | --- |
| `works` | `id` | names and aliases |
| `characters` | `id`, `work_id` | localized names, aliases, hidden/soft-delete flags |
| `manufacturers` | `id` | canonical name, aliases, draft/active/hidden status |
| `figure_prototypes` | `id`, `character_ids`, `work_id`, `manufacturer_id`, `merged_into_id`, `main_image_id` | type, scale, flags, publication state, timestamps |
| `figure_versions` | `id`, `prototype_id` | version kind, name, notes |
| `source_records` | `id`, `prototype_id` | source type/ID/URL, normalized fallback URL, unavailable flag, raw snapshot |
| `candidate_records` | `id`, `source_id`, `target_prototype_id`, `target_version_id` | raw fields, status, decisions and reason |
| `candidate_images` | `id`, `candidate_id`, `prototype_id`, `media_id` | `storage_key`, source URL, byte size, dimensions, format, SHA-256, perceptual hash, adult/source/main flags |
| `operation_logs` | `id`, `actor_id`, `undo_of_id` | actor label, timestamp, operation, reason, before/after state and related IDs |
| `system_settings` | `id` | adult visibility, page size, public-read switch |

`main_image_id` and `media_id` refer to stable local Wagtail media records.
`storage_key` remains portable across storage backends. `original_url` is only
provenance metadata and never serves as image identity. SHA-256 is exact-byte
identity; perceptual hash is only a possible-duplicate hint.
