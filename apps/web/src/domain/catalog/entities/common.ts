import { randomUUID } from 'node:crypto'

import {
  CatalogDomainError,
  normalizeCatalogName,
  type CatalogCommandResult,
} from '@figure-gallery/domain-contracts'

import {
  queryRows,
  requireByStableId,
  sql,
  type CatalogRow,
  type CatalogTableName,
} from '../repository'
import type { CatalogSqlTransaction } from '../transactions'

export { randomUUID }

export function rowId(row: CatalogRow): number | string {
  if (typeof row.id !== 'number' && typeof row.id !== 'string')
    throw new Error('Catalog row has no ID.')
  return row.id
}

export function rowStableId(row: CatalogRow): string {
  if (typeof row.stable_id !== 'string') throw new Error('Catalog row has no stable ID.')
  return row.stable_id
}

export function rowVersion(row: CatalogRow): number {
  const version = Number(row.lock_version)
  if (!Number.isInteger(version) || version < 1)
    throw new Error('Catalog row has no valid lock version.')
  return version
}

export function optionalText(value: unknown): null | string {
  if (value === null || value === undefined || value === '') return null
  return String(value).trim()
}

export function requiredText(value: string, field: string): string {
  const text = value.trim()
  if (!text) {
    throw new CatalogDomainError(
      'CATALOG_COMMAND_INVALID',
      `${field} must not be empty.`,
      'validation',
      {
        field,
      },
    )
  }
  return text
}

export function resultFor(
  entityType: string,
  row: CatalogRow,
  operationId: string,
  options: {
    relatedStableId?: string
    status?: string
    warnings?: CatalogCommandResult['warnings']
  } = {},
): CatalogCommandResult {
  return {
    entityType,
    lockVersion: rowVersion(row),
    operationId,
    relatedStableId: options.relatedStableId,
    stableId: rowStableId(row),
    status: options.status,
    warnings: options.warnings,
  }
}

export async function requireRelation(
  transaction: CatalogSqlTransaction,
  table: CatalogTableName,
  stableId: string,
): Promise<CatalogRow> {
  return requireByStableId(transaction, table, stableId)
}

export async function ensureUniqueNormalizedName(input: {
  code: 'FIGURE_VERSION_DUPLICATE' | 'MANUFACTURER_DUPLICATE'
  excludeStableId?: string
  normalized: string
  table: CatalogTableName
  transaction: CatalogSqlTransaction
}): Promise<void> {
  const excludeCurrent = input.excludeStableId
    ? sql`and stable_id <> ${input.excludeStableId}`
    : sql``
  const rows = await queryRows(
    input.transaction,
    sql`select stable_id from ${sql.identifier(input.table)} where normalized_name = ${input.normalized} and deleted_at is null ${excludeCurrent} limit 1`,
  )
  if (rows.length) {
    throw new CatalogDomainError(
      input.code,
      'An active entity already uses the normalized name.',
      'conflict',
      {
        normalizedName: input.normalized,
      },
    )
  }
}

export function normalizeRequired(
  value: string,
  field: string,
): { normalized: string; raw: string } {
  const raw = requiredText(value, field)
  return { normalized: normalizeCatalogName(raw), raw }
}

export function assertNotDeleted(row: CatalogRow): void {
  if (row.deleted_at) {
    throw new CatalogDomainError(
      'CATALOG_ENTITY_DELETED',
      'The catalog entity is soft-deleted and must be restored first.',
      'conflict',
      { stableId: row.stable_id },
    )
  }
}

export function assertDeleted(row: CatalogRow): void {
  if (!row.deleted_at) {
    throw new CatalogDomainError(
      'CATALOG_ENTITY_NOT_DELETED',
      'The catalog entity is not soft-deleted.',
      'conflict',
      { stableId: row.stable_id },
    )
  }
}
