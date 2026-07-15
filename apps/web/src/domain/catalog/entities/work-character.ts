import { randomUUID } from 'node:crypto'

import {
  CatalogDomainError,
  CHARACTER_STATUS_TRANSITIONS,
  WORK_STATUS_TRANSITIONS,
  buildCharacterSearchDocument,
  normalizeCatalogName,
  transitionIsAllowed,
  type CatalogCommand,
  type CatalogCommandResult,
  type CharacterStatus,
  type WorkPublicationStatus,
} from '@figure-gallery/domain-contracts'

import {
  compareAndSwap,
  insertRow,
  queryRows,
  requireByStableId,
  sql,
  TABLES,
  updateRow,
  type CatalogRow,
} from '../repository'
import type { CatalogSqlTransaction } from '../transactions'
import type { CatalogMutationOutcome } from '../types'
import {
  assertDeleted,
  assertNotDeleted,
  optionalText,
  requiredText,
  resultFor,
  rowId,
  rowStableId,
  rowVersion,
} from './common'

type WorkCharacterCommand = Extract<
  CatalogCommand,
  {
    type:
      | 'addCharacterAlias'
      | 'createCharacter'
      | 'createWork'
      | 'removeCharacterAlias'
      | 'restoreCharacter'
      | 'restoreWork'
      | 'setCharacterStatus'
      | 'setWorkPublicationStatus'
      | 'softDeleteCharacter'
      | 'softDeleteWork'
      | 'updateCharacter'
      | 'updateCharacterAlias'
      | 'updateWork'
  }
>

const BCP47_STYLE_PATTERN = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/iu

function timestamp(): Date {
  return new Date()
}

function asNullableText(row: CatalogRow, column: string): null | string {
  const value = row[column]
  return value === null || value === undefined ? null : String(value)
}

function workSnapshot(row: CatalogRow): Readonly<Record<string, unknown>> {
  return {
    deletedAt: row.deleted_at ?? null,
    displayName: row.display_name,
    lockVersion: rowVersion(row),
    originalName: row.original_name ?? null,
    publicationStatus: row.publication_status,
    stableId: rowStableId(row),
    workType: row.work_type,
  }
}

function characterSnapshot(
  row: CatalogRow,
  workStableId: null | string,
): Readonly<Record<string, unknown>> {
  return {
    deletedAt: row.deleted_at ?? null,
    displayName: row.display_name,
    lockVersion: rowVersion(row),
    nameEn: row.name_en ?? null,
    nameJa: row.name_ja ?? null,
    nameZh: row.name_zh ?? null,
    searchDocument: row.search_document,
    stableId: rowStableId(row),
    status: row.status,
    workStableId,
  }
}

function aliasSnapshot(row: CatalogRow): Readonly<Record<string, unknown>> {
  return {
    aliasType: row.alias_type,
    deletedAt: row.deleted_at ?? null,
    isPreferred: row.is_preferred,
    locale: row.locale ?? null,
    normalizedValue: row.normalized_value,
    stableId: rowStableId(row),
    value: row.value,
  }
}

function characterResult(row: CatalogRow, operationId: string, relatedStableId?: string) {
  return resultFor('Character', row, operationId, {
    relatedStableId,
    status: String(row.status),
  })
}

function workResult(
  row: CatalogRow,
  operationId: string,
  warnings?: CatalogCommandResult['warnings'],
) {
  return resultFor('Work', row, operationId, {
    status: String(row.publication_status),
    warnings,
  })
}

async function duplicateWorkWarnings(
  transaction: CatalogSqlTransaction,
  normalizedName: string,
  excludeStableId: string,
): Promise<NonNullable<CatalogCommandResult['warnings']>> {
  const rows = await queryRows(
    transaction,
    sql`select 1 from ${sql.identifier(TABLES.works)} where normalized_name = ${normalizedName} and deleted_at is null and stable_id <> ${excludeStableId} limit 1`,
  )
  return rows.length
    ? [
        {
          code: 'WORK_NORMALIZED_NAME_DUPLICATE',
          message:
            'Another undeleted Work has the same normalized display name. The save was allowed; review both Works for disambiguation.',
        },
      ]
    : []
}

function assertTransition<T extends string>(input: {
  entityType: 'Character' | 'Work'
  from: T
  stableId: string
  to: T
  transitions: Readonly<Record<T, readonly T[]>>
}): void {
  if (transitionIsAllowed(input.transitions, input.from, input.to)) return
  throw new CatalogDomainError(
    'CATALOG_TRANSITION_FORBIDDEN',
    `${input.entityType} cannot transition from ${input.from} to ${input.to}.`,
    'conflict',
    {
      from: input.from,
      stableId: input.stableId,
      to: input.to,
    },
  )
}

function normalizeLocale(value: null | string | undefined): null | string {
  const trimmed = optionalText(value)
  if (!trimmed) return null
  if (!BCP47_STYLE_PATTERN.test(trimmed)) {
    throw new CatalogDomainError(
      'CATALOG_COMMAND_INVALID',
      'locale must be a BCP 47-style language tag.',
      'validation',
      { field: 'locale' },
    )
  }

  return trimmed
    .split('-')
    .map((part, index) => {
      if (index === 0) return part.toLowerCase()
      if (/^[a-z]{4}$/iu.test(part)) {
        return `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`
      }
      if (/^[a-z]{2}$/iu.test(part) || /^\d{3}$/u.test(part)) return part.toUpperCase()
      return part.toLowerCase()
    })
    .join('-')
}

async function workStableIdForInternalId(
  transaction: CatalogSqlTransaction,
  workId: unknown,
): Promise<null | string> {
  if (workId === null || workId === undefined) return null
  const rows = await queryRows(
    transaction,
    sql`select stable_id from ${sql.identifier(TABLES.works)} where id = ${workId} limit 1`,
  )
  return rows[0] && typeof rows[0].stable_id === 'string' ? rows[0].stable_id : null
}

async function workNameForInternalId(
  transaction: CatalogSqlTransaction,
  workId: unknown,
): Promise<null | string> {
  if (workId === null || workId === undefined) return null
  const rows = await queryRows(
    transaction,
    sql`select display_name from ${sql.identifier(TABLES.works)} where id = ${workId} limit 1`,
  )
  return rows[0] && typeof rows[0].display_name === 'string' ? rows[0].display_name : null
}

async function activeAliasValues(
  transaction: CatalogSqlTransaction,
  characterId: number | string,
): Promise<string[]> {
  const rows = await queryRows(
    transaction,
    sql`select value from ${sql.identifier(TABLES.characterAliases)} where character_id = ${characterId} and deleted_at is null order by normalized_value, stable_id`,
  )
  return rows.flatMap((row) => (typeof row.value === 'string' ? [row.value] : []))
}

async function searchDocumentForCharacter(
  transaction: CatalogSqlTransaction,
  character: CatalogRow,
  workNameOverride?: null | string,
): Promise<string> {
  const workName =
    workNameOverride === undefined
      ? await workNameForInternalId(transaction, character.work_id)
      : workNameOverride
  return buildCharacterSearchDocument({
    aliases: await activeAliasValues(transaction, rowId(character)),
    displayName: String(character.display_name),
    nameEn: asNullableText(character, 'name_en'),
    nameJa: asNullableText(character, 'name_ja'),
    nameZh: asNullableText(character, 'name_zh'),
    workName,
  })
}

async function rebuildCharactersForRenamedWork(input: {
  actorUserId: number | string
  transaction: CatalogSqlTransaction
  workId: number | string
  workName: string
}): Promise<number> {
  const characters = await queryRows(
    input.transaction,
    sql`select * from ${sql.identifier(TABLES.characters)} where work_id = ${input.workId} order by stable_id`,
  )
  const now = timestamp()
  for (const character of characters) {
    const searchDocument = await searchDocumentForCharacter(
      input.transaction,
      character,
      input.workName,
    )
    await compareAndSwap(
      input.transaction,
      TABLES.characters,
      rowStableId(character),
      rowVersion(character),
      {
        search_document: searchDocument,
        updated_at: now,
        updated_by_id: input.actorUserId,
      },
    )
  }
  return characters.length
}

async function assertCharacterNotUsedByEligiblePrototype(
  transaction: CatalogSqlTransaction,
  character: CatalogRow,
): Promise<void> {
  const rows = await queryRows(
    transaction,
    sql`select prototype.stable_id
        from ${sql.identifier(TABLES.figurePrototypeCharacters)} relation
        join ${sql.identifier(TABLES.figurePrototypes)} prototype on prototype.id = relation.prototype_id
        where relation.character_id = ${rowId(character)}
          and relation.deleted_at is null
          and prototype.inclusion_status = 'eligible'
          and prototype.archived_at is null
        limit 1`,
  )
  if (!rows.length) return
  throw new CatalogDomainError(
    'CHARACTER_IN_USE_BY_ELIGIBLE_PROTOTYPE',
    'A character used by an eligible prototype cannot be hidden or deleted.',
    'conflict',
    {
      characterStableId: rowStableId(character),
      prototypeStableId: rows[0]?.stable_id,
    },
  )
}

async function ensureAliasAvailable(input: {
  characterId: number | string
  characterStableId: string
  excludeStableId?: string
  isPreferred: boolean
  locale: null | string
  normalizedValue: string
  transaction: CatalogSqlTransaction
}): Promise<void> {
  const excludeCurrent = input.excludeStableId
    ? sql`and stable_id <> ${input.excludeStableId}`
    : sql``
  const duplicates = await queryRows(
    input.transaction,
    sql`select stable_id
        from ${sql.identifier(TABLES.characterAliases)}
        where character_id = ${input.characterId}
          and normalized_value = ${input.normalizedValue}
          and coalesce(locale, '') = coalesce(${input.locale}, '')
          and deleted_at is null
          ${excludeCurrent}
        limit 1`,
  )
  if (duplicates.length) {
    throw new CatalogDomainError(
      'CHARACTER_ALIAS_DUPLICATE',
      'The character already has this normalized alias for the locale.',
      'conflict',
      {
        characterStableId: input.characterStableId,
        locale: input.locale,
        normalizedValue: input.normalizedValue,
      },
    )
  }

  if (!input.isPreferred) return
  const preferred = await queryRows(
    input.transaction,
    sql`select stable_id
        from ${sql.identifier(TABLES.characterAliases)}
        where character_id = ${input.characterId}
          and coalesce(locale, '') = coalesce(${input.locale}, '')
          and is_preferred = true
          and deleted_at is null
          ${excludeCurrent}
        limit 1`,
  )
  if (preferred.length) {
    throw new CatalogDomainError(
      'CHARACTER_ALIAS_PREFERRED_CONFLICT',
      'The character already has a preferred alias for the locale.',
      'conflict',
      {
        characterStableId: input.characterStableId,
        locale: input.locale,
      },
    )
  }
}

function assertAliasBelongsToCharacter(alias: CatalogRow, character: CatalogRow): void {
  if (String(alias.character_id) === String(rowId(character))) return
  throw new CatalogDomainError(
    'CATALOG_RELATION_INVALID',
    'The alias does not belong to the requested character.',
    'conflict',
    {
      aliasStableId: rowStableId(alias),
      characterStableId: rowStableId(character),
    },
  )
}

async function createWork(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'createWork' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const displayName = requiredText(command.displayName, 'displayName')
  const now = timestamp()
  const row = await insertRow(transaction, TABLES.works, {
    created_at: now,
    created_by_id: actorUserId,
    deleted_at: null,
    deleted_by_id: null,
    delete_reason: null,
    display_name: displayName,
    lock_version: 1,
    normalized_name: normalizeCatalogName(displayName),
    original_name: optionalText(command.originalName),
    publication_status: 'draft',
    stable_id: randomUUID(),
    updated_at: now,
    updated_by_id: actorUserId,
    work_type: command.workType ?? 'other',
  })
  const warnings = await duplicateWorkWarnings(
    transaction,
    String(row.normalized_name),
    rowStableId(row),
  )
  return {
    after: workSnapshot(row),
    result: workResult(row, command.operationId, warnings),
    scopeStableId: rowStableId(row),
    scopeType: 'Work',
  }
}

async function updateWork(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'updateWork' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const before = await requireByStableId(transaction, TABLES.works, command.stableId)
  assertNotDeleted(before)
  const displayName =
    command.displayName === undefined
      ? String(before.display_name)
      : requiredText(command.displayName, 'displayName')
  const now = timestamp()
  const after = await compareAndSwap(
    transaction,
    TABLES.works,
    command.stableId,
    command.expectedVersion,
    {
      display_name: displayName,
      normalized_name: normalizeCatalogName(displayName),
      original_name:
        command.originalName === undefined
          ? (before.original_name ?? null)
          : optionalText(command.originalName),
      updated_at: now,
      updated_by_id: actorUserId,
      work_type: command.workType === undefined ? before.work_type : (command.workType ?? 'other'),
    },
  )
  const renamed = String(before.display_name) !== displayName
  const rebuiltCharacterCount = renamed
    ? await rebuildCharactersForRenamedWork({
        actorUserId,
        transaction,
        workId: rowId(after),
        workName: displayName,
      })
    : 0
  const warnings = await duplicateWorkWarnings(
    transaction,
    String(after.normalized_name),
    rowStableId(after),
  )
  return {
    after: { ...workSnapshot(after), rebuiltCharacterCount },
    before: workSnapshot(before),
    result: workResult(after, command.operationId, warnings),
    scopeStableId: command.stableId,
    scopeType: 'Work',
  }
}

async function setWorkPublicationStatus(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'setWorkPublicationStatus' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const before = await requireByStableId(transaction, TABLES.works, command.stableId)
  assertNotDeleted(before)
  const from = String(before.publication_status) as WorkPublicationStatus
  assertTransition({
    entityType: 'Work',
    from,
    stableId: command.stableId,
    to: command.publicationStatus,
    transitions: WORK_STATUS_TRANSITIONS,
  })
  const after = await compareAndSwap(
    transaction,
    TABLES.works,
    command.stableId,
    command.expectedVersion,
    {
      publication_status: command.publicationStatus,
      updated_at: timestamp(),
      updated_by_id: actorUserId,
    },
  )
  return {
    after: workSnapshot(after),
    before: workSnapshot(before),
    result: workResult(after, command.operationId),
    scopeStableId: command.stableId,
    scopeType: 'Work',
  }
}

async function softDeleteWork(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'softDeleteWork' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const before = await requireByStableId(transaction, TABLES.works, command.stableId)
  assertNotDeleted(before)
  const now = timestamp()
  const after = await compareAndSwap(
    transaction,
    TABLES.works,
    command.stableId,
    command.expectedVersion,
    {
      deleted_at: now,
      deleted_by_id: actorUserId,
      delete_reason: command.reason.trim(),
      updated_at: now,
      updated_by_id: actorUserId,
    },
  )
  return {
    after: workSnapshot(after),
    before: workSnapshot(before),
    result: workResult(after, command.operationId),
    scopeStableId: command.stableId,
    scopeType: 'Work',
  }
}

async function restoreWork(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'restoreWork' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const before = await requireByStableId(transaction, TABLES.works, command.stableId, {
    allowDeleted: true,
  })
  assertDeleted(before)
  const after = await compareAndSwap(
    transaction,
    TABLES.works,
    command.stableId,
    command.expectedVersion,
    {
      deleted_at: null,
      deleted_by_id: null,
      delete_reason: null,
      updated_at: timestamp(),
      updated_by_id: actorUserId,
    },
  )
  return {
    after: workSnapshot(after),
    before: workSnapshot(before),
    result: workResult(after, command.operationId),
    scopeStableId: command.stableId,
    scopeType: 'Work',
  }
}

async function resolveWork(input: {
  stableId: null | string | undefined
  transaction: CatalogSqlTransaction
}): Promise<{ id: null | number | string; name: null | string; stableId: null | string }> {
  if (!input.stableId) return { id: null, name: null, stableId: null }
  const rows = await queryRows(
    input.transaction,
    sql`select * from ${sql.identifier(TABLES.works)} where stable_id = ${input.stableId} limit 1 for share`,
  )
  const work = rows[0]
  if (!work) {
    throw new CatalogDomainError(
      'CATALOG_ENTITY_NOT_FOUND',
      'The requested catalog entity does not exist.',
      'not_found',
      { stableId: input.stableId },
    )
  }
  assertNotDeleted(work)
  return {
    id: rowId(work),
    name: String(work.display_name),
    stableId: rowStableId(work),
  }
}

async function createCharacter(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'createCharacter' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const displayName = requiredText(command.displayName, 'displayName')
  const work = await resolveWork({ stableId: command.workStableId, transaction })
  const nameEn = optionalText(command.nameEn)
  const nameJa = optionalText(command.nameJa)
  const nameZh = optionalText(command.nameZh)
  const now = timestamp()
  const row = await insertRow(transaction, TABLES.characters, {
    created_at: now,
    created_by_id: actorUserId,
    deleted_at: null,
    deleted_by_id: null,
    delete_reason: null,
    display_name: displayName,
    lock_version: 1,
    name_en: nameEn,
    name_ja: nameJa,
    name_zh: nameZh,
    normalized_name: normalizeCatalogName(displayName),
    search_document: buildCharacterSearchDocument({
      displayName,
      nameEn,
      nameJa,
      nameZh,
      workName: work.name,
    }),
    stable_id: randomUUID(),
    status: command.status ?? 'matching_pending',
    updated_at: now,
    updated_by_id: actorUserId,
    work_id: work.id,
  })
  return {
    after: characterSnapshot(row, work.stableId),
    result: characterResult(row, command.operationId),
    scopeStableId: rowStableId(row),
    scopeType: 'Character',
  }
}

async function updateCharacter(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'updateCharacter' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const before = await requireByStableId(transaction, TABLES.characters, command.stableId)
  assertNotDeleted(before)
  const previousWorkStableId = await workStableIdForInternalId(transaction, before.work_id)
  const work =
    command.workStableId === undefined
      ? {
          id: (before.work_id ?? null) as null | number | string,
          name: await workNameForInternalId(transaction, before.work_id),
          stableId: previousWorkStableId,
        }
      : await resolveWork({ stableId: command.workStableId, transaction })
  const displayName =
    command.displayName === undefined
      ? String(before.display_name)
      : requiredText(command.displayName, 'displayName')
  const nameEn =
    command.nameEn === undefined ? asNullableText(before, 'name_en') : optionalText(command.nameEn)
  const nameJa =
    command.nameJa === undefined ? asNullableText(before, 'name_ja') : optionalText(command.nameJa)
  const nameZh =
    command.nameZh === undefined ? asNullableText(before, 'name_zh') : optionalText(command.nameZh)
  const searchDocument = buildCharacterSearchDocument({
    aliases: await activeAliasValues(transaction, rowId(before)),
    displayName,
    nameEn,
    nameJa,
    nameZh,
    workName: work.name,
  })
  const after = await compareAndSwap(
    transaction,
    TABLES.characters,
    command.stableId,
    command.expectedVersion,
    {
      display_name: displayName,
      name_en: nameEn,
      name_ja: nameJa,
      name_zh: nameZh,
      normalized_name: normalizeCatalogName(displayName),
      search_document: searchDocument,
      updated_at: timestamp(),
      updated_by_id: actorUserId,
      work_id: work.id,
    },
  )
  return {
    after: characterSnapshot(after, work.stableId),
    before: characterSnapshot(before, previousWorkStableId),
    result: characterResult(after, command.operationId),
    scopeStableId: command.stableId,
    scopeType: 'Character',
  }
}

async function addCharacterAlias(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'addCharacterAlias' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const beforeCharacter = await requireByStableId(transaction, TABLES.characters, command.stableId)
  assertNotDeleted(beforeCharacter)
  const value = requiredText(command.value, 'value')
  const locale = normalizeLocale(command.locale)
  const normalizedValue = normalizeCatalogName(value)
  await ensureAliasAvailable({
    characterId: rowId(beforeCharacter),
    characterStableId: command.stableId,
    isPreferred: command.isPreferred ?? false,
    locale,
    normalizedValue,
    transaction,
  })
  const now = timestamp()
  const alias = await insertRow(transaction, TABLES.characterAliases, {
    alias_type: command.aliasType,
    character_id: rowId(beforeCharacter),
    created_at: now,
    created_by_id: actorUserId,
    deleted_at: null,
    deleted_by_id: null,
    delete_reason: null,
    is_preferred: command.isPreferred ?? false,
    locale,
    normalized_value: normalizedValue,
    stable_id: randomUUID(),
    updated_at: now,
    value,
  })
  const workStableId = await workStableIdForInternalId(transaction, beforeCharacter.work_id)
  const afterCharacter = await compareAndSwap(
    transaction,
    TABLES.characters,
    command.stableId,
    command.expectedVersion,
    {
      search_document: await searchDocumentForCharacter(transaction, beforeCharacter),
      updated_at: now,
      updated_by_id: actorUserId,
    },
  )
  return {
    after: {
      alias: aliasSnapshot(alias),
      character: characterSnapshot(afterCharacter, workStableId),
    },
    before: { character: characterSnapshot(beforeCharacter, workStableId) },
    result: characterResult(afterCharacter, command.operationId, rowStableId(alias)),
    scopeStableId: command.stableId,
    scopeType: 'Character',
  }
}

async function updateCharacterAlias(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'updateCharacterAlias' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const beforeCharacter = await requireByStableId(transaction, TABLES.characters, command.stableId)
  assertNotDeleted(beforeCharacter)
  const beforeAlias = await requireByStableId(
    transaction,
    TABLES.characterAliases,
    command.aliasStableId,
  )
  assertNotDeleted(beforeAlias)
  assertAliasBelongsToCharacter(beforeAlias, beforeCharacter)
  const value =
    command.value === undefined ? String(beforeAlias.value) : requiredText(command.value, 'value')
  const locale =
    command.locale === undefined
      ? asNullableText(beforeAlias, 'locale')
      : normalizeLocale(command.locale)
  const normalizedValue = normalizeCatalogName(value)
  const isPreferred =
    command.isPreferred === undefined ? beforeAlias.is_preferred === true : command.isPreferred
  await ensureAliasAvailable({
    characterId: rowId(beforeCharacter),
    characterStableId: command.stableId,
    excludeStableId: command.aliasStableId,
    isPreferred,
    locale,
    normalizedValue,
    transaction,
  })
  const now = timestamp()
  const afterAlias = await updateRow(transaction, TABLES.characterAliases, command.aliasStableId, {
    alias_type: command.aliasType ?? beforeAlias.alias_type,
    is_preferred: isPreferred,
    locale,
    normalized_value: normalizedValue,
    updated_at: now,
    value,
  })
  const workStableId = await workStableIdForInternalId(transaction, beforeCharacter.work_id)
  const afterCharacter = await compareAndSwap(
    transaction,
    TABLES.characters,
    command.stableId,
    command.expectedVersion,
    {
      search_document: await searchDocumentForCharacter(transaction, beforeCharacter),
      updated_at: now,
      updated_by_id: actorUserId,
    },
  )
  return {
    after: {
      alias: aliasSnapshot(afterAlias),
      character: characterSnapshot(afterCharacter, workStableId),
    },
    before: {
      alias: aliasSnapshot(beforeAlias),
      character: characterSnapshot(beforeCharacter, workStableId),
    },
    result: characterResult(afterCharacter, command.operationId, command.aliasStableId),
    scopeStableId: command.stableId,
    scopeType: 'Character',
  }
}

async function removeCharacterAlias(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'removeCharacterAlias' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const beforeCharacter = await requireByStableId(transaction, TABLES.characters, command.stableId)
  assertNotDeleted(beforeCharacter)
  const beforeAlias = await requireByStableId(
    transaction,
    TABLES.characterAliases,
    command.aliasStableId,
  )
  assertNotDeleted(beforeAlias)
  assertAliasBelongsToCharacter(beforeAlias, beforeCharacter)
  const now = timestamp()
  const afterAlias = await updateRow(transaction, TABLES.characterAliases, command.aliasStableId, {
    deleted_at: now,
    deleted_by_id: actorUserId,
    delete_reason: command.reason.trim(),
    updated_at: now,
  })
  const workStableId = await workStableIdForInternalId(transaction, beforeCharacter.work_id)
  const afterCharacter = await compareAndSwap(
    transaction,
    TABLES.characters,
    command.stableId,
    command.expectedVersion,
    {
      search_document: await searchDocumentForCharacter(transaction, beforeCharacter),
      updated_at: now,
      updated_by_id: actorUserId,
    },
  )
  return {
    after: {
      alias: aliasSnapshot(afterAlias),
      character: characterSnapshot(afterCharacter, workStableId),
    },
    before: {
      alias: aliasSnapshot(beforeAlias),
      character: characterSnapshot(beforeCharacter, workStableId),
    },
    result: characterResult(afterCharacter, command.operationId, command.aliasStableId),
    scopeStableId: command.stableId,
    scopeType: 'Character',
  }
}

async function setCharacterStatus(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'setCharacterStatus' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const before = await requireByStableId(transaction, TABLES.characters, command.stableId)
  assertNotDeleted(before)
  const from = String(before.status) as CharacterStatus
  assertTransition({
    entityType: 'Character',
    from,
    stableId: command.stableId,
    to: command.status,
    transitions: CHARACTER_STATUS_TRANSITIONS,
  })
  const workStableId = await workStableIdForInternalId(transaction, before.work_id)
  const after = await compareAndSwap(
    transaction,
    TABLES.characters,
    command.stableId,
    command.expectedVersion,
    {
      status: command.status,
      updated_at: timestamp(),
      updated_by_id: actorUserId,
    },
  )
  return {
    after: characterSnapshot(after, workStableId),
    before: characterSnapshot(before, workStableId),
    result: characterResult(after, command.operationId),
    scopeStableId: command.stableId,
    scopeType: 'Character',
  }
}

async function softDeleteCharacter(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'softDeleteCharacter' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const before = await requireByStableId(transaction, TABLES.characters, command.stableId)
  assertNotDeleted(before)
  await assertCharacterNotUsedByEligiblePrototype(transaction, before)
  const workStableId = await workStableIdForInternalId(transaction, before.work_id)
  const now = timestamp()
  const after = await compareAndSwap(
    transaction,
    TABLES.characters,
    command.stableId,
    command.expectedVersion,
    {
      deleted_at: now,
      deleted_by_id: actorUserId,
      delete_reason: command.reason.trim(),
      updated_at: now,
      updated_by_id: actorUserId,
    },
  )
  await assertCharacterNotUsedByEligiblePrototype(transaction, after)
  return {
    after: characterSnapshot(after, workStableId),
    before: characterSnapshot(before, workStableId),
    result: characterResult(after, command.operationId),
    scopeStableId: command.stableId,
    scopeType: 'Character',
  }
}

async function restoreCharacter(
  transaction: CatalogSqlTransaction,
  command: Extract<WorkCharacterCommand, { type: 'restoreCharacter' }>,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const before = await requireByStableId(transaction, TABLES.characters, command.stableId, {
    allowDeleted: true,
  })
  assertDeleted(before)
  const workStableId = await workStableIdForInternalId(transaction, before.work_id)
  const after = await compareAndSwap(
    transaction,
    TABLES.characters,
    command.stableId,
    command.expectedVersion,
    {
      deleted_at: null,
      deleted_by_id: null,
      delete_reason: null,
      updated_at: timestamp(),
      updated_by_id: actorUserId,
    },
  )
  return {
    after: characterSnapshot(after, workStableId),
    before: characterSnapshot(before, workStableId),
    result: characterResult(after, command.operationId),
    scopeStableId: command.stableId,
    scopeType: 'Character',
  }
}

export async function executeWorkCharacterCommand(
  transaction: CatalogSqlTransaction,
  command: CatalogCommand,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome | null> {
  switch (command.type) {
    case 'createWork':
      return createWork(transaction, command, actorUserId)
    case 'updateWork':
      return updateWork(transaction, command, actorUserId)
    case 'setWorkPublicationStatus':
      return setWorkPublicationStatus(transaction, command, actorUserId)
    case 'softDeleteWork':
      return softDeleteWork(transaction, command, actorUserId)
    case 'restoreWork':
      return restoreWork(transaction, command, actorUserId)
    case 'createCharacter':
      return createCharacter(transaction, command, actorUserId)
    case 'updateCharacter':
      return updateCharacter(transaction, command, actorUserId)
    case 'addCharacterAlias':
      return addCharacterAlias(transaction, command, actorUserId)
    case 'updateCharacterAlias':
      return updateCharacterAlias(transaction, command, actorUserId)
    case 'removeCharacterAlias':
      return removeCharacterAlias(transaction, command, actorUserId)
    case 'setCharacterStatus':
      return setCharacterStatus(transaction, command, actorUserId)
    case 'softDeleteCharacter':
      return softDeleteCharacter(transaction, command, actorUserId)
    case 'restoreCharacter':
      return restoreCharacter(transaction, command, actorUserId)
    default:
      return null
  }
}
