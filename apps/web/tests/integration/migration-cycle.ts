import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { getPayload, type PayloadRequest } from 'payload'

import config from '../../src/payload.config'
import * as baseline from '../../src/migrations/20260715_114831_pr00_baseline'
import * as catalog from '../../src/migrations/20260715_151314_pr01_core_catalog'

const payload = await getPayload({ config })
const req = { context: {}, payload, user: null } as unknown as PayloadRequest
const migrationDb = payload.db.drizzle as Parameters<typeof baseline.up>[0]['db']

const REQUIRED_PR01_SCHEMA_OBJECTS = [
  'works_stable_id_uuid_chk',
  'characters_stable_id_uuid_chk',
  'character_aliases_stable_id_uuid_chk',
  'manufacturers_stable_id_uuid_chk',
  'figure_prototypes_stable_id_uuid_chk',
  'figure_prototype_characters_stable_id_uuid_chk',
  'figure_versions_stable_id_uuid_chk',
  'works_lock_version_positive_chk',
  'characters_lock_version_positive_chk',
  'manufacturers_lock_version_positive_chk',
  'figure_prototypes_lock_version_positive_chk',
  'figure_versions_lock_version_positive_chk',
  'works_soft_delete_attribution_chk',
  'characters_soft_delete_attribution_chk',
  'character_aliases_soft_delete_attribution_chk',
  'manufacturers_soft_delete_attribution_chk',
  'figure_prototype_characters_soft_delete_attribution_chk',
  'figure_versions_soft_delete_attribution_chk',
  'figure_prototype_characters_display_order_nonnegative_chk',
  'figure_versions_gray_completeness_chk',
  'operation_logs_operation_id_uuid_chk',
  'operation_logs_scope_stable_id_uuid_chk',
  'operation_logs_request_digest_chk',
  'operation_logs_expected_version_positive_chk',
  'operation_logs_result_version_positive_chk',
  'operation_logs_required_text_chk',
  'operation_logs_not_reversible_chk',
  'figure_prototypes_adult_entry_false_chk',
  'figure_prototypes_publication_unavailable_chk',
  'figure_prototypes_merged_target_chk',
  'figure_prototypes_archive_attribution_chk',
  'figure_prototypes_rejected_authorization_chk',
  'figure_prototypes_inclusion_review_chk',
  'figure_prototypes_eligible_authorization_chk',
  'manufacturers_active_normalized_name_uq',
  'character_aliases_active_value_locale_uq',
  'character_aliases_active_preferred_locale_uq',
  'figure_prototype_characters_active_pair_uq',
  'figure_prototype_characters_active_display_order_uq',
  'figure_prototype_characters_active_primary_uq',
  'figure_versions_active_prototype_key_uq',
] as const

async function signature(): Promise<{ digest: string; entries: string[]; tables: string[] }> {
  const state = await payload.db.pool.query<{ entry: string }>(`
    SELECT entry FROM (
      -- PostgreSQL does not reuse dropped attribute numbers. A down/up cycle therefore changes
      -- information_schema.ordinal_position for re-added columns even when the logical schema is
      -- identical. Compare the stable logical column contract rather than physical attnums.
      SELECT 'column|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || COALESCE(column_default, '') AS entry
        FROM information_schema.columns WHERE table_schema = 'public'
      UNION ALL
      SELECT 'constraint|' || c.conname || '|' || pg_get_constraintdef(c.oid)
        FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'index|' || tablename || '|' || indexname || '|' || indexdef
        FROM pg_indexes WHERE schemaname = 'public'
      UNION ALL
      SELECT 'enum|' || t.typname || '|' || e.enumsortorder::text || '|' || e.enumlabel
        FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
    ) state ORDER BY entry
  `)
  const entries = state.rows.map(({ entry }) => entry)
  const tablesResult = await payload.db.pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  )
  return {
    digest: createHash('sha256').update(entries.join('\n')).digest('hex'),
    entries,
    tables: tablesResult.rows.map(({ tablename }) => tablename),
  }
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

try {
  await baseline.up({ db: migrationDb, payload, req })
  const baselineBefore = await signature()
  check(baselineBefore.tables.includes('users'), 'PR-00 baseline must include users.')
  check(!baselineBefore.tables.includes('works'), 'PR-00 baseline must not include PR-01 tables.')

  await catalog.up({ db: migrationDb, payload, req })
  const catalogFirst = await signature()
  check(catalogFirst.tables.includes('works'), 'PR-01 up must create catalog tables.')
  check(catalogFirst.tables.includes('operation_logs'), 'PR-01 up must create OperationLog.')
  const schemaObjects = await payload.db.pool.query<{ name: string }>(`
    SELECT conname AS name
      FROM pg_constraint constraint_record
      JOIN pg_namespace namespace_record
        ON namespace_record.oid = constraint_record.connamespace
      WHERE namespace_record.nspname = 'public'
    UNION ALL
    SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public'
  `)
  const schemaObjectNames = new Set(schemaObjects.rows.map(({ name }) => name))
  const missingSchemaObjects = REQUIRED_PR01_SCHEMA_OBJECTS.filter(
    (name) => !schemaObjectNames.has(name),
  )
  check(
    missingSchemaObjects.length === 0,
    `PR-01 schema objects are missing: ${missingSchemaObjects.join(', ')}`,
  )

  await catalog.down({ db: migrationDb, payload, req })
  const baselineAfter = await signature()
  check(
    baselineAfter.digest === baselineBefore.digest,
    'PR-01 down must return to the exact PR-00 schema signature.',
  )

  await catalog.up({ db: migrationDb, payload, req })
  const catalogSecond = await signature()
  check(
    catalogSecond.digest === catalogFirst.digest,
    'PR-01 up after rollback must reproduce the same final schema signature.',
  )

  const output = process.env.PR01_MIGRATION_OUTPUT
  if (output) {
    mkdirSync(path.dirname(output), { recursive: true })
    writeFileSync(
      output,
      `${JSON.stringify(
        {
          baselineDigest: baselineBefore.digest,
          finalDigest: catalogFirst.digest,
          generatedAt: new Date().toISOString(),
          hpoiRequests: 0,
          pr01TableCount: catalogFirst.tables.length - baselineBefore.tables.length,
          requiredSchemaObjectCount: REQUIRED_PR01_SCHEMA_OBJECTS.length,
          schemaVersion: 1,
          verified: ['baseline-up', 'pr01-up', 'pr01-down', 'baseline-signature', 'pr01-reup'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  }
  process.stdout.write('PR-01 migration baseline/up/down/up cycle passed.\n')
} finally {
  await payload.destroy()
}
