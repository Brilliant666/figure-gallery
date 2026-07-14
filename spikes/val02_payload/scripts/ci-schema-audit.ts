import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getPayload } from 'payload'

const outputArg = process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)
if (!outputArg) throw new Error('--out=<runner-temp-json-path> is required.')
if (process.env.PAYLOAD_CI_PRODUCTION_GATE !== 'true') {
  throw new Error('ci-schema-audit is restricted to the explicit production-gate runner.')
}
if (process.env.DATABASE_ADAPTER !== 'postgres') {
  throw new Error('ci-schema-audit requires the PostgreSQL adapter.')
}

type QueryResult = { rows: Record<string, unknown>[] }

const { default: config } = await import('@payload-config')
const payload = await getPayload({ config })

try {
  const pool = (payload.db as unknown as {
    pool: { query: (sql: string, values?: unknown[]) => Promise<QueryResult> }
  }).pool
  if (!pool?.query) throw new Error('The active adapter did not expose a PostgreSQL pool.')

  const tables = await pool.query(
    `select table_name
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  )
  const columns = await pool.query(
    `select table_name, column_name, is_nullable
       from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (
          ('source_records', 'source_key'),
          ('source_records', 'prototype_id'),
          ('source_records', 'invalidated'),
          ('source_records', 'status'),
          ('candidate_records', 'candidate_owner_id'),
          ('review_work_items', 'lock_version'),
          ('operation_logs', 'operation_i_d'),
          ('figure_prototypes', 'main_image_id'),
          ('figure_prototypes', 'soft_deleted'),
          ('figure_versions', 'prototype_id'),
          ('media', 'candidate_owner_id'),
          ('media', 'prefix'),
          ('media', 'storage_key')
        )
      order by table_name, column_name`,
  )
  const indexes = await pool.query(
    `select indexname, indexdef
       from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'source_records_source_key_idx',
          'candidate_records_source_idx',
          'operation_logs_operation_i_d_idx'
        )
      order by indexname`,
  )
  const foreignKeys = await pool.query(
    `select tc.table_name, kcu.column_name, ccu.table_name as foreign_table_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
       join information_schema.constraint_column_usage ccu
         on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
      where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
        and (tc.table_name, kcu.column_name) in (
          ('figure_prototypes', 'main_image_id'),
          ('figure_versions', 'prototype_id'),
          ('source_records', 'prototype_id'),
          ('candidate_records', 'candidate_owner_id'),
          ('media', 'candidate_owner_id')
        )
      order by tc.table_name, kcu.column_name`,
  )
  const migrations = await pool.query(
    'select name, batch from payload_migrations order by id',
  )

  const requiredTables = [
    'candidate_records',
    'figure_prototypes',
    'figure_versions',
    'media',
    'operation_logs',
    'payload_migrations',
    'review_work_items',
    'source_records',
    'system_settings',
  ]
  const tableNames = new Set(tables.rows.map((row) => String(row.table_name)))
  const missingTables = requiredTables.filter((table) => !tableNames.has(table))
  const columnPairs = new Set(
    columns.rows.map((row) => `${String(row.table_name)}.${String(row.column_name)}`),
  )
  const requiredColumns = [
    'candidate_records.candidate_owner_id',
    'figure_prototypes.main_image_id',
    'figure_prototypes.soft_deleted',
    'figure_versions.prototype_id',
    'media.candidate_owner_id',
    'media.prefix',
    'media.storage_key',
    'operation_logs.operation_i_d',
    'review_work_items.lock_version',
    'source_records.invalidated',
    'source_records.prototype_id',
    'source_records.source_key',
    'source_records.status',
  ]
  const missingColumns = requiredColumns.filter((column) => !columnPairs.has(column))
  const uniqueIndexes = new Set(
    indexes.rows
      .filter((row) => String(row.indexdef).includes(' UNIQUE '))
      .map((row) => String(row.indexname)),
  )
  const missingUniqueIndexes = [
    'candidate_records_source_idx',
    'operation_logs_operation_i_d_idx',
    'source_records_source_key_idx',
  ].filter((index) => !uniqueIndexes.has(index))
  const reviewLock = columns.rows.find(
    (row) => row.table_name === 'review_work_items' && row.column_name === 'lock_version',
  )
  const failures = [
    ...(missingTables.length ? [`missing tables: ${missingTables.join(', ')}`] : []),
    ...(missingColumns.length ? [`missing columns: ${missingColumns.join(', ')}`] : []),
    ...(missingUniqueIndexes.length
      ? [`missing unique indexes: ${missingUniqueIndexes.join(', ')}`]
      : []),
    ...(reviewLock?.is_nullable !== 'NO' ? ['review_work_items.lock_version is nullable'] : []),
    ...(foreignKeys.rows.length !== 5 ? [`expected 5 selected foreign keys, found ${foreignKeys.rows.length}`] : []),
    ...(migrations.rows.length < 1 ? ['no PostgreSQL migration record found'] : []),
  ]
  if (failures.length) throw new Error(`PostgreSQL schema audit failed: ${failures.join('; ')}`)

  const output = path.resolve(outputArg)
  const summary = {
    schema_version: 1,
    adapter: 'postgres',
    checked_columns: requiredColumns,
    checked_foreign_keys: foreignKeys.rows.map(
      (row) => `${String(row.table_name)}.${String(row.column_name)}->${String(row.foreign_table_name)}`,
    ),
    checked_tables: requiredTables,
    checked_unique_indexes: [...uniqueIndexes].sort(),
    foreign_key_checks: foreignKeys.rows.length,
    migration_count: migrations.rows.length,
    migration_names: migrations.rows.map((row) => String(row.name)),
    required_column_checks: requiredColumns.length,
    required_table_checks: requiredTables.length,
    table_count: tables.rows.length,
    unique_index_checks: uniqueIndexes.size,
  }
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ output, status: 'schema-audit-passed' }))
} finally {
  await payload.destroy()
}
