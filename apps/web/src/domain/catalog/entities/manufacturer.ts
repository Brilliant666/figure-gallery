import {
  CatalogDomainError,
  MANUFACTURER_STATUS_TRANSITIONS,
  normalizeCatalogName,
  transitionIsAllowed,
  type CatalogCommand,
  type ManufacturerAliasInput,
} from '@figure-gallery/domain-contracts'

import {
  compareAndSwap,
  insertRow,
  queryRows,
  requireByStableId,
  sql,
  TABLES,
  type CatalogRow,
} from '../repository'
import type { CatalogSqlTransaction } from '../transactions'
import type { CatalogMutationOutcome } from '../types'
import {
  assertDeleted,
  assertNotDeleted,
  ensureUniqueNormalizedName,
  normalizeRequired,
  optionalText,
  randomUUID,
  resultFor,
  rowId,
  rowVersion,
} from './common'

type ManufacturerCommand = Extract<
  CatalogCommand,
  {
    type:
      | 'createManufacturer'
      | 'restoreManufacturer'
      | 'setManufacturerStatus'
      | 'softDeleteManufacturer'
      | 'updateManufacturer'
  }
>

async function manufacturerSnapshot(
  transaction: CatalogSqlTransaction,
  row: CatalogRow,
): Promise<Readonly<Record<string, unknown>>> {
  const aliases = await queryRows(
    transaction,
    sql`select value, normalized_value, locale from ${sql.identifier(TABLES.manufacturerAliases)} where ${sql.identifier('_parent_id')} = ${rowId(row)} order by ${sql.identifier('_order')}`,
  )
  return {
    aliases: aliases.map((alias) => ({
      locale: alias.locale ?? null,
      normalizedValue: alias.normalized_value,
      value: alias.value,
    })),
    authorizationNote: row.authorization_note ?? null,
    canonicalName: row.canonical_name,
    deletedAt: row.deleted_at ?? null,
    lockVersion: rowVersion(row),
    normalizedName: row.normalized_name,
    officialSiteUrl: row.official_site_url ?? null,
    sourceEvidence: row.source_evidence ?? null,
    stableId: row.stable_id,
    status: row.status,
  }
}

function normalizedAliases(aliases: ManufacturerAliasInput[]): Array<{
  locale: null | string
  normalizedValue: string
  value: string
}> {
  const result = aliases.map((alias) => {
    const value = alias.value.trim()
    if (!value) throw new CatalogDomainError('CATALOG_COMMAND_INVALID', 'Alias value is required.')
    return {
      locale: alias.locale?.trim() || null,
      normalizedValue: normalizeCatalogName(value),
      value,
    }
  })
  const keys = result.map((alias) => `${alias.locale ?? ''}\u0000${alias.normalizedValue}`)
  if (new Set(keys).size !== keys.length) {
    throw new CatalogDomainError(
      'MANUFACTURER_DUPLICATE',
      'Manufacturer aliases must be unique by locale and normalized value.',
      'conflict',
    )
  }
  return result
}

async function replaceAliases(
  transaction: CatalogSqlTransaction,
  parentId: number | string,
  aliases: ManufacturerAliasInput[],
): Promise<void> {
  await transaction.execute(
    sql`delete from ${sql.identifier(TABLES.manufacturerAliases)} where ${sql.identifier('_parent_id')} = ${parentId}`,
  )
  let order = 1
  for (const alias of normalizedAliases(aliases)) {
    await insertRow(transaction, TABLES.manufacturerAliases, {
      _order: order,
      _parent_id: parentId,
      id: randomUUID(),
      locale: alias.locale,
      normalized_value: alias.normalizedValue,
      value: alias.value,
    })
    order += 1
  }
}

async function assertNotUsedByEligiblePrototype(
  transaction: CatalogSqlTransaction,
  manufacturerId: number | string,
): Promise<void> {
  const rows = await queryRows(
    transaction,
    sql`select stable_id from ${sql.identifier(TABLES.figurePrototypes)} where manufacturer_id = ${manufacturerId} and inclusion_status = 'eligible' and archived_at is null limit 1`,
  )
  if (rows.length) {
    throw new CatalogDomainError(
      'MANUFACTURER_IN_USE_BY_ELIGIBLE_PROTOTYPE',
      'An eligible prototype still depends on this manufacturer.',
      'conflict',
      { prototypeStableId: rows[0]?.stable_id },
    )
  }
}

export async function executeManufacturerCommand(
  transaction: CatalogSqlTransaction,
  command: CatalogCommand,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome | null> {
  if (!command.type.includes('Manufacturer')) return null
  const manufacturerCommand = command as ManufacturerCommand
  const now = new Date()

  if (manufacturerCommand.type === 'createManufacturer') {
    const name = normalizeRequired(manufacturerCommand.canonicalName, 'canonicalName')
    await ensureUniqueNormalizedName({
      code: 'MANUFACTURER_DUPLICATE',
      normalized: name.normalized,
      table: TABLES.manufacturers,
      transaction,
    })
    const row = await insertRow(transaction, TABLES.manufacturers, {
      authorization_note: optionalText(manufacturerCommand.authorizationNote),
      canonical_name: name.raw,
      created_at: now,
      created_by_id: actorUserId,
      deleted_at: null,
      deleted_by_id: null,
      delete_reason: null,
      lock_version: 1,
      normalized_name: name.normalized,
      official_site_url: optionalText(manufacturerCommand.officialSiteUrl),
      source_evidence: manufacturerCommand.sourceEvidence ?? null,
      stable_id: randomUUID(),
      status: 'draft',
      updated_at: now,
      updated_by_id: actorUserId,
    })
    await replaceAliases(transaction, rowId(row), manufacturerCommand.aliases ?? [])
    const result = resultFor('Manufacturer', row, command.operationId, { status: 'draft' })
    return {
      after: await manufacturerSnapshot(transaction, row),
      result,
      scopeStableId: result.stableId,
      scopeType: 'Manufacturer',
    }
  }

  const beforeRow = await requireByStableId(
    transaction,
    TABLES.manufacturers,
    manufacturerCommand.stableId,
    { allowDeleted: true },
  )
  const before = await manufacturerSnapshot(transaction, beforeRow)
  const patch: Record<string, unknown> = { updated_at: now, updated_by_id: actorUserId }

  if (manufacturerCommand.type === 'updateManufacturer') {
    assertNotDeleted(beforeRow)
    if (manufacturerCommand.canonicalName !== undefined) {
      const name = normalizeRequired(manufacturerCommand.canonicalName, 'canonicalName')
      await ensureUniqueNormalizedName({
        code: 'MANUFACTURER_DUPLICATE',
        excludeStableId: manufacturerCommand.stableId,
        normalized: name.normalized,
        table: TABLES.manufacturers,
        transaction,
      })
      patch.canonical_name = name.raw
      patch.normalized_name = name.normalized
    }
    if (manufacturerCommand.authorizationNote !== undefined) {
      patch.authorization_note = optionalText(manufacturerCommand.authorizationNote)
    }
    if (manufacturerCommand.officialSiteUrl !== undefined) {
      patch.official_site_url = optionalText(manufacturerCommand.officialSiteUrl)
    }
    if (manufacturerCommand.sourceEvidence !== undefined) {
      patch.source_evidence = manufacturerCommand.sourceEvidence
    }
  } else if (manufacturerCommand.type === 'setManufacturerStatus') {
    assertNotDeleted(beforeRow)
    const current = String(beforeRow.status) as keyof typeof MANUFACTURER_STATUS_TRANSITIONS
    if (
      !transitionIsAllowed(MANUFACTURER_STATUS_TRANSITIONS, current, manufacturerCommand.status)
    ) {
      throw new CatalogDomainError(
        'CATALOG_TRANSITION_FORBIDDEN',
        `Manufacturer cannot transition from ${current} to ${manufacturerCommand.status}.`,
        'conflict',
      )
    }
    if (manufacturerCommand.status !== 'active') {
      await assertNotUsedByEligiblePrototype(transaction, rowId(beforeRow))
    }
    patch.status = manufacturerCommand.status
  } else if (manufacturerCommand.type === 'softDeleteManufacturer') {
    assertNotDeleted(beforeRow)
    await assertNotUsedByEligiblePrototype(transaction, rowId(beforeRow))
    patch.deleted_at = now
    patch.deleted_by_id = actorUserId
    patch.delete_reason = command.reason.trim()
  } else {
    assertDeleted(beforeRow)
    await ensureUniqueNormalizedName({
      code: 'MANUFACTURER_DUPLICATE',
      excludeStableId: manufacturerCommand.stableId,
      normalized: String(beforeRow.normalized_name),
      table: TABLES.manufacturers,
      transaction,
    })
    patch.deleted_at = null
    patch.deleted_by_id = null
    patch.delete_reason = null
  }

  const row = await compareAndSwap(
    transaction,
    TABLES.manufacturers,
    manufacturerCommand.stableId,
    manufacturerCommand.expectedVersion,
    patch,
  )
  if (
    (manufacturerCommand.type === 'setManufacturerStatus' &&
      manufacturerCommand.status !== 'active') ||
    manufacturerCommand.type === 'softDeleteManufacturer'
  ) {
    await assertNotUsedByEligiblePrototype(transaction, rowId(row))
  }
  if (
    manufacturerCommand.type === 'updateManufacturer' &&
    manufacturerCommand.aliases !== undefined
  ) {
    await replaceAliases(transaction, rowId(row), manufacturerCommand.aliases)
  }
  const result = resultFor('Manufacturer', row, command.operationId, { status: String(row.status) })
  return {
    after: await manufacturerSnapshot(transaction, row),
    before,
    result,
    scopeStableId: result.stableId,
    scopeType: 'Manufacturer',
  }
}
