import { sql } from '@payloadcms/db-postgres'

import { CatalogDomainError } from '@figure-gallery/domain-contracts'

import type { CatalogSqlTransaction } from './transactions'

export const TABLES = {
  characterAliases: 'character_aliases',
  characters: 'characters',
  figurePrototypeCharacters: 'figure_prototype_characters',
  figurePrototypes: 'figure_prototypes',
  figureVersions: 'figure_versions',
  manufacturerAliases: 'manufacturers_aliases',
  manufacturers: 'manufacturers',
  operationLogs: 'operation_logs',
  users: 'users',
  works: 'works',
} as const

export type CatalogTableName = (typeof TABLES)[keyof typeof TABLES]
export type CatalogRow = Record<string, unknown>

type QueryRows = { rows?: CatalogRow[] }

function rowsFromResult(result: unknown): CatalogRow[] {
  if (Array.isArray(result)) return result as CatalogRow[]
  if (result && typeof result === 'object' && Array.isArray((result as QueryRows).rows)) {
    return (result as QueryRows).rows ?? []
  }
  return []
}

function identifiers(values: readonly string[]) {
  return values.map((value) => sql.identifier(value))
}

function parameters(values: readonly unknown[]) {
  return values.map((value) => sql`${value}`)
}

export async function executeRows(
  transaction: CatalogSqlTransaction,
  query: unknown,
): Promise<CatalogRow[]> {
  return rowsFromResult(await transaction.execute(query))
}

export async function lockOperation(
  transaction: CatalogSqlTransaction,
  operationId: string,
): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${operationId}, 0))`)
}

export async function findByStableId(
  transaction: CatalogSqlTransaction,
  table: CatalogTableName,
  stableId: string,
): Promise<CatalogRow | null> {
  const rows = await executeRows(
    transaction,
    sql`select * from ${sql.identifier(table)} where ${sql.identifier('stable_id')} = ${stableId} limit 1`,
  )
  return rows[0] ?? null
}

export async function requireByStableId(
  transaction: CatalogSqlTransaction,
  table: CatalogTableName,
  stableId: string,
  options: { allowDeleted?: boolean } = {},
): Promise<CatalogRow> {
  const row = await findByStableId(transaction, table, stableId)
  if (!row) {
    throw new CatalogDomainError(
      'CATALOG_ENTITY_NOT_FOUND',
      'The requested catalog entity does not exist.',
      'not_found',
      { stableId },
    )
  }
  if (!options.allowDeleted && row.deleted_at) {
    throw new CatalogDomainError(
      'CATALOG_ENTITY_DELETED',
      'The requested catalog entity is soft-deleted.',
      'conflict',
      { stableId },
    )
  }
  return row
}

export async function insertRow(
  transaction: CatalogSqlTransaction,
  table: CatalogTableName,
  data: Readonly<Record<string, unknown>>,
): Promise<CatalogRow> {
  const entries = Object.entries(data)
  const columns = identifiers(entries.map(([key]) => key))
  const values = parameters(entries.map(([, value]) => value))
  const rows = await executeRows(
    transaction,
    sql`insert into ${sql.identifier(table)} (${sql.join(columns, sql`, `)}) values (${sql.join(values, sql`, `)}) returning *`,
  )
  const row = rows[0]
  if (!row) throw new Error(`Insert into ${table} did not return a row.`)
  return row
}

export async function updateRow(
  transaction: CatalogSqlTransaction,
  table: CatalogTableName,
  stableId: string,
  data: Readonly<Record<string, unknown>>,
): Promise<CatalogRow> {
  const assignments = Object.entries(data).map(
    ([column, value]) => sql`${sql.identifier(column)} = ${value}`,
  )
  const rows = await executeRows(
    transaction,
    sql`update ${sql.identifier(table)} set ${sql.join(assignments, sql`, `)} where ${sql.identifier('stable_id')} = ${stableId} returning *`,
  )
  const row = rows[0]
  if (!row) {
    throw new CatalogDomainError(
      'CATALOG_ENTITY_NOT_FOUND',
      'The requested catalog entity does not exist.',
      'not_found',
      { stableId },
    )
  }
  return row
}

export async function compareAndSwap(
  transaction: CatalogSqlTransaction,
  table: CatalogTableName,
  stableId: string,
  expectedVersion: number,
  data: Readonly<Record<string, unknown>>,
): Promise<CatalogRow> {
  const assignments = Object.entries(data).map(
    ([column, value]) => sql`${sql.identifier(column)} = ${value}`,
  )
  assignments.push(sql`${sql.identifier('lock_version')} = ${sql.identifier('lock_version')} + 1`)
  const rows = await executeRows(
    transaction,
    sql`update ${sql.identifier(table)} set ${sql.join(assignments, sql`, `)} where ${sql.identifier('stable_id')} = ${stableId} and ${sql.identifier('lock_version')} = ${expectedVersion} returning *`,
  )
  if (rows[0]) return rows[0]

  const current = await findByStableId(transaction, table, stableId)
  if (!current) {
    throw new CatalogDomainError(
      'CATALOG_ENTITY_NOT_FOUND',
      'The requested catalog entity does not exist.',
      'not_found',
      { stableId },
    )
  }
  throw new CatalogDomainError(
    'CATALOG_VERSION_CONFLICT',
    'The catalog entity changed after it was read.',
    'conflict',
    { actualVersion: current.lock_version, expectedVersion, stableId },
  )
}

export async function queryRows(
  transaction: CatalogSqlTransaction,
  query: unknown,
): Promise<CatalogRow[]> {
  return executeRows(transaction, query)
}

export { sql }
