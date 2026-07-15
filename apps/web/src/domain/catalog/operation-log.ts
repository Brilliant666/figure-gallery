import { createHash } from 'node:crypto'

import type {
  CatalogCommand,
  CatalogCommandResult,
  JsonValue,
} from '@figure-gallery/domain-contracts'

import { insertRow, lockOperation, queryRows, sql, TABLES, type CatalogRow } from './repository'
import type { CatalogSqlTransaction } from './transactions'

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function catalogRequestDigest(command: CatalogCommand): string {
  return createHash('sha256').update(canonicalize(command)).digest('hex')
}

export async function findOperationReplay(
  transaction: CatalogSqlTransaction,
  operationId: string,
  requestDigest: string,
): Promise<{ digestMatches: boolean; found: boolean; result?: CatalogCommandResult }> {
  await lockOperation(transaction, operationId)
  const rows = await queryRows(
    transaction,
    sql`select * from ${sql.identifier(TABLES.operationLogs)} where ${sql.identifier('operation_id')} = ${operationId} limit 1`,
  )
  const row = rows[0]
  if (!row) return { digestMatches: false, found: false }
  if (row.request_digest !== requestDigest) {
    return { digestMatches: false, found: true, result: undefined }
  }
  const after = row.after_snapshot
  if (!after || typeof after !== 'object' || Array.isArray(after)) {
    return { digestMatches: true, found: true }
  }
  const result = (after as Record<string, unknown>).result
  return result && typeof result === 'object'
    ? { digestMatches: true, found: true, result: result as CatalogCommandResult }
    : { digestMatches: true, found: true }
}

function jsonSnapshot(value: Readonly<Record<string, unknown>>): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export async function appendOperationLog(input: {
  actorUserId: number | string
  after: Readonly<Record<string, unknown>>
  before?: Readonly<Record<string, unknown>>
  command: CatalogCommand
  requestDigest: string
  result: CatalogCommandResult
  scopeStableId: string
  scopeType: string
  transaction: CatalogSqlTransaction
}): Promise<CatalogRow> {
  const now = new Date()
  const dutyContext = input.command.type.startsWith('reviewPrototype')
    ? 'catalog_review'
    : 'catalog_maintenance'
  return insertRow(input.transaction, TABLES.operationLogs, {
    action: input.command.type,
    actor_type: 'admin',
    actor_user_id: input.actorUserId,
    after_snapshot: jsonSnapshot({ ...input.after, result: input.result }),
    before_snapshot: input.before ? jsonSnapshot(input.before) : null,
    created_at: now,
    duty_context: dutyContext,
    expected_version: 'expectedVersion' in input.command ? input.command.expectedVersion : null,
    operation_id: input.command.operationId,
    reason: input.command.reason.trim(),
    request_digest: input.requestDigest,
    result_version: input.result.lockVersion,
    reversible: false,
    scope_stable_id: input.scopeStableId,
    scope_type: input.scopeType,
    updated_at: now,
  })
}
