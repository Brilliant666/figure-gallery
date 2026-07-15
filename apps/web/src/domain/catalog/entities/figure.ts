import {
  CatalogDomainError,
  PR01_PROTOTYPE_STATUS_TRANSITIONS,
  authorizationQualifiesForInclusion,
  buildNormalizedVersionKey,
  grayCompletenessIsValid,
  transitionIsAllowed,
  validatePrototypeCharacters,
  type CatalogCommand,
  type FigureReleaseStatus,
  type FigureVersionKind,
  type GrayModelCompleteness,
  type PrototypeAuthorizationStatus,
  type PrototypeCharacterCommandInput,
} from '@figure-gallery/domain-contracts'

import {
  compareAndSwap,
  findByStableId,
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
  normalizeRequired,
  optionalText,
  randomUUID,
  resultFor,
  rowId,
  rowVersion,
} from './common'

type PrototypeCommand = Extract<
  CatalogCommand,
  {
    type:
      | 'archivePrototype'
      | 'createFigurePrototype'
      | 'restorePrototype'
      | 'reviewPrototypeAuthorization'
      | 'reviewPrototypeInclusion'
      | 'setPrototypeCharacters'
      | 'setPrototypePublicationStatus'
      | 'updateFigurePrototype'
  }
>

type VersionCommand = Extract<
  CatalogCommand,
  {
    type:
      | 'createFigureVersion'
      | 'restoreFigureVersion'
      | 'softDeleteFigureVersion'
      | 'updateFigureVersion'
  }
>

async function stableIdForInternalId(
  transaction: CatalogSqlTransaction,
  table: string,
  id: unknown,
): Promise<null | string> {
  if (id === null || id === undefined) return null
  const rows = await queryRows(
    transaction,
    sql`select stable_id from ${sql.identifier(table)} where id = ${id} limit 1`,
  )
  return rows[0] && typeof rows[0].stable_id === 'string' ? rows[0].stable_id : null
}

async function prototypeSnapshot(
  transaction: CatalogSqlTransaction,
  row: CatalogRow,
): Promise<Readonly<Record<string, unknown>>> {
  const relations = await queryRows(
    transaction,
    sql`select relation.stable_id, relation.display_order, relation.role, character.stable_id as character_stable_id
        from ${sql.identifier(TABLES.figurePrototypeCharacters)} relation
        join ${sql.identifier(TABLES.characters)} character on character.id = relation.character_id
        where relation.prototype_id = ${rowId(row)} and relation.deleted_at is null
        order by relation.display_order, relation.stable_id`,
  )
  return {
    adultEntryFlag: row.adult_entry_flag,
    archiveReason: row.archive_reason ?? null,
    archivedAt: row.archived_at ?? null,
    authorizationEvidence: row.authorization_evidence ?? null,
    authorizationReason: row.authorization_reason ?? null,
    authorizationReviewedAt: row.authorization_reviewed_at ?? null,
    authorizationStatus: row.authorization_status,
    characters: relations.map((relation) => ({
      characterStableId: relation.character_stable_id,
      displayOrder: relation.display_order,
      relationStableId: relation.stable_id,
      role: relation.role,
    })),
    costumeText: row.costume_text ?? null,
    figureType: row.figure_type,
    inclusionReason: row.inclusion_reason ?? null,
    inclusionReviewedAt: row.inclusion_reviewed_at ?? null,
    inclusionStatus: row.inclusion_status,
    isGroup: row.is_group,
    lockVersion: rowVersion(row),
    manufacturerStableId: await stableIdForInternalId(
      transaction,
      TABLES.manufacturers,
      row.manufacturer_id,
    ),
    mergedIntoStableId: await stableIdForInternalId(
      transaction,
      TABLES.figurePrototypes,
      row.merged_into_id,
    ),
    normalizedTitle: row.normalized_title,
    publicationStatus: row.publication_status,
    scale: row.scale ?? null,
    stableId: row.stable_id,
    title: row.title,
    workStableId: await stableIdForInternalId(transaction, TABLES.works, row.work_id),
  }
}

async function versionSnapshot(
  transaction: CatalogSqlTransaction,
  row: CatalogRow,
): Promise<Readonly<Record<string, unknown>>> {
  return {
    channelOrDistributorLabel: row.channel_or_distributor_label ?? null,
    deletedAt: row.deleted_at ?? null,
    grayModelCompleteness: row.gray_model_completeness,
    kind: row.kind,
    lockVersion: rowVersion(row),
    name: row.name,
    normalizedVersionKey: row.normalized_version_key,
    notes: row.notes ?? null,
    prototypeStableId: await stableIdForInternalId(
      transaction,
      TABLES.figurePrototypes,
      row.prototype_id,
    ),
    releaseDate: row.release_date ?? null,
    releaseStatus: row.release_status,
    skuOrCode: row.sku_or_code ?? null,
    stableId: row.stable_id,
  }
}

async function resolveOptionalRelation(
  transaction: CatalogSqlTransaction,
  table: typeof TABLES.works,
  stableId: null | string | undefined,
): Promise<null | number | string> {
  if (!stableId) return null
  return rowId(await requireByStableId(transaction, table, stableId))
}

async function resolveManufacturer(
  transaction: CatalogSqlTransaction,
  stableId: string,
): Promise<CatalogRow> {
  return requireByStableId(transaction, TABLES.manufacturers, stableId)
}

async function lockPrototypeByStableId(
  transaction: CatalogSqlTransaction,
  stableId: string,
  mode: 'share' | 'update',
): Promise<CatalogRow> {
  const rows = await queryRows(
    transaction,
    mode === 'update'
      ? sql`select * from ${sql.identifier(TABLES.figurePrototypes)} where stable_id = ${stableId} limit 1 for update`
      : sql`select * from ${sql.identifier(TABLES.figurePrototypes)} where stable_id = ${stableId} limit 1 for share`,
  )
  const prototype = rows[0]
  if (!prototype) {
    throw new CatalogDomainError(
      'CATALOG_ENTITY_NOT_FOUND',
      'The requested catalog entity does not exist.',
      'not_found',
      { stableId },
    )
  }
  return prototype
}

async function lockPrototypeByInternalId(
  transaction: CatalogSqlTransaction,
  prototypeId: number | string,
): Promise<CatalogRow> {
  const rows = await queryRows(
    transaction,
    sql`select * from ${sql.identifier(TABLES.figurePrototypes)} where id = ${prototypeId} limit 1 for share`,
  )
  const prototype = rows[0]
  if (!prototype) {
    throw new CatalogDomainError(
      'CATALOG_RELATION_INVALID',
      'The FigureVersion parent prototype does not exist.',
      'conflict',
    )
  }
  return prototype
}

function assertPrototypeAcceptsVersionMutation(prototype: CatalogRow): void {
  if (prototype.publication_status === 'archived' || prototype.archived_at) {
    throw new CatalogDomainError(
      'CATALOG_ENTITY_DELETED',
      'Archived prototypes do not accept ordinary FigureVersion mutations.',
      'conflict',
    )
  }
}

async function resolvePrototypeCharacters(
  transaction: CatalogSqlTransaction,
  characters: PrototypeCharacterCommandInput[],
  isGroup: boolean,
): Promise<Array<{ characterId: number | string; input: PrototypeCharacterCommandInput }>> {
  const errors = validatePrototypeCharacters(characters, isGroup)
  if (errors.length) {
    const code = errors.some((message) => message.includes('primary'))
      ? 'PROTOTYPE_PRIMARY_CHARACTER_REQUIRED'
      : errors.some((message) => message.includes('isGroup'))
        ? 'PROTOTYPE_GROUP_FLAG_INVALID'
        : 'PROTOTYPE_CHARACTER_REQUIRED'
    throw new CatalogDomainError(code, errors.join('; '), 'validation')
  }
  const resolved = []
  for (const input of characters) {
    const character = await requireByStableId(
      transaction,
      TABLES.characters,
      input.characterStableId,
    )
    resolved.push({ characterId: rowId(character), input })
  }
  return resolved
}

async function replacePrototypeCharacters(input: {
  actorUserId: number | string
  characters: PrototypeCharacterCommandInput[]
  isGroup: boolean
  prototypeId: number | string
  reason: string
  transaction: CatalogSqlTransaction
}): Promise<void> {
  const resolved = await resolvePrototypeCharacters(
    input.transaction,
    input.characters,
    input.isGroup,
  )
  const now = new Date()
  await input.transaction.execute(
    sql`update ${sql.identifier(TABLES.figurePrototypeCharacters)} set deleted_at = ${now}, deleted_by_id = ${input.actorUserId}, delete_reason = ${input.reason}, updated_at = ${now} where prototype_id = ${input.prototypeId} and deleted_at is null`,
  )
  for (const relation of resolved) {
    await insertRow(input.transaction, TABLES.figurePrototypeCharacters, {
      character_id: relation.characterId,
      created_at: now,
      created_by_id: input.actorUserId,
      deleted_at: null,
      deleted_by_id: null,
      delete_reason: null,
      display_order: relation.input.displayOrder,
      prototype_id: input.prototypeId,
      role: relation.input.role,
      stable_id: randomUUID(),
      updated_at: now,
    })
  }
}

async function undeletedPrototypeRelations(
  transaction: CatalogSqlTransaction,
  prototypeId: number | string,
): Promise<CatalogRow[]> {
  return queryRows(
    transaction,
    sql`select pc.*, c.deleted_at as character_deleted_at, c.status as character_status from ${sql.identifier(TABLES.figurePrototypeCharacters)} pc join ${sql.identifier(TABLES.characters)} c on c.id = pc.character_id where pc.prototype_id = ${prototypeId} and pc.deleted_at is null and c.deleted_at is null order by pc.display_order for update of pc, c`,
  )
}

async function qualifyingVersions(
  transaction: CatalogSqlTransaction,
  prototypeId: number | string,
): Promise<CatalogRow[]> {
  return queryRows(
    transaction,
    sql`select * from ${sql.identifier(TABLES.figureVersions)} where prototype_id = ${prototypeId} and deleted_at is null and (release_status in ('announced', 'painted_prototype', 'preorder', 'released') or (release_status = 'gray_prototype' and gray_model_completeness = 'complete')) for update`,
  )
}

async function assertPrototypeEligible(
  transaction: CatalogSqlTransaction,
  prototype: CatalogRow,
): Promise<void> {
  if (prototype.archived_at || prototype.publication_status === 'archived') {
    throw new CatalogDomainError(
      'PROTOTYPE_ELIGIBILITY_NOT_MET',
      'Archived prototypes are not eligible.',
    )
  }
  if (
    !authorizationQualifiesForInclusion(
      String(prototype.authorization_status) as PrototypeAuthorizationStatus,
    )
  ) {
    throw new CatalogDomainError(
      'PROTOTYPE_AUTHORIZATION_REQUIRED',
      'An accepted authorization review is required for inclusion.',
    )
  }
  const manufacturerRows = await queryRows(
    transaction,
    sql`select status, deleted_at from ${sql.identifier(TABLES.manufacturers)} where id = ${prototype.manufacturer_id} limit 1 for update`,
  )
  if (manufacturerRows[0]?.status !== 'active' || manufacturerRows[0]?.deleted_at) {
    throw new CatalogDomainError(
      'MANUFACTURER_NOT_ACTIVE',
      'The prototype manufacturer must be active.',
    )
  }
  const relations = await undeletedPrototypeRelations(transaction, rowId(prototype))
  if (!relations.length) {
    throw new CatalogDomainError(
      'PROTOTYPE_CHARACTER_REQUIRED',
      'At least one undeleted character is required.',
    )
  }
  if (relations.filter((row) => row.role === 'primary').length !== 1) {
    throw new CatalogDomainError(
      'PROTOTYPE_PRIMARY_CHARACTER_REQUIRED',
      'Exactly one undeleted primary character is required.',
    )
  }
  if ((await qualifyingVersions(transaction, rowId(prototype))).length === 0) {
    throw new CatalogDomainError(
      'PROTOTYPE_ELIGIBILITY_NOT_MET',
      'At least one qualifying figure version is required.',
    )
  }
}

async function assertEligiblePrototypeStillValid(
  transaction: CatalogSqlTransaction,
  prototypeId: number | string,
): Promise<void> {
  const rows = await queryRows(
    transaction,
    sql`select * from ${sql.identifier(TABLES.figurePrototypes)} where id = ${prototypeId} limit 1`,
  )
  const prototype = rows[0]
  if (prototype?.inclusion_status === 'eligible') {
    try {
      await assertPrototypeEligible(transaction, prototype)
    } catch (error) {
      if (error instanceof CatalogDomainError) {
        throw new CatalogDomainError(
          'PROTOTYPE_ELIGIBILITY_WOULD_BE_BROKEN',
          error.message,
          'conflict',
          error.details,
        )
      }
      throw error
    }
  }
}

async function ensureUniqueVersionKey(input: {
  excludeStableId?: string
  normalizedVersionKey: string
  prototypeId: number | string
  transaction: CatalogSqlTransaction
}): Promise<void> {
  const rows = await queryRows(
    input.transaction,
    sql`select stable_id from ${sql.identifier(TABLES.figureVersions)} where prototype_id = ${input.prototypeId} and normalized_version_key = ${input.normalizedVersionKey} and deleted_at is null and (${input.excludeStableId ?? null} is null or stable_id <> ${input.excludeStableId ?? null}) limit 1`,
  )
  if (rows.length) {
    throw new CatalogDomainError(
      'FIGURE_VERSION_DUPLICATE',
      'This prototype already has an active version with the same normalized key.',
      'conflict',
    )
  }
}

function validateGrayModel(
  releaseStatus: FigureReleaseStatus,
  grayModelCompleteness: GrayModelCompleteness,
): void {
  if (!grayCompletenessIsValid(releaseStatus, grayModelCompleteness)) {
    throw new CatalogDomainError(
      'GRAY_MODEL_COMPLETENESS_INVALID',
      'grayModelCompleteness does not match releaseStatus.',
      'validation',
    )
  }
}

export async function executePrototypeCommand(
  transaction: CatalogSqlTransaction,
  command: CatalogCommand,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome | null> {
  if (
    ![
      'archivePrototype',
      'createFigurePrototype',
      'restorePrototype',
      'reviewPrototypeAuthorization',
      'reviewPrototypeInclusion',
      'setPrototypeCharacters',
      'setPrototypePublicationStatus',
      'updateFigurePrototype',
    ].includes(command.type)
  )
    return null
  const prototypeCommand = command as PrototypeCommand
  const now = new Date()

  if (prototypeCommand.type === 'createFigurePrototype') {
    const title = normalizeRequired(prototypeCommand.title, 'title')
    if (!['scale', 'prize'].includes(prototypeCommand.figureType)) {
      throw new CatalogDomainError(
        'FIGURE_TYPE_NOT_SUPPORTED',
        'Only scale and prize are supported.',
      )
    }
    const manufacturer = await resolveManufacturer(
      transaction,
      prototypeCommand.manufacturerStableId,
    )
    const workId = await resolveOptionalRelation(
      transaction,
      TABLES.works,
      prototypeCommand.workStableId,
    )
    const characters = await resolvePrototypeCharacters(
      transaction,
      prototypeCommand.characters,
      prototypeCommand.isGroup,
    )
    const row = await insertRow(transaction, TABLES.figurePrototypes, {
      adult_entry_flag: false,
      archived_at: null,
      archived_by_id: null,
      archive_reason: null,
      authorization_evidence: null,
      authorization_reason: null,
      authorization_reviewed_at: null,
      authorization_reviewed_by_id: null,
      authorization_status: 'pending',
      costume_text: optionalText(prototypeCommand.costumeText),
      created_at: now,
      created_by_id: actorUserId,
      figure_type: prototypeCommand.figureType,
      inclusion_reason: null,
      inclusion_reviewed_at: null,
      inclusion_reviewed_by_id: null,
      inclusion_status: 'pending',
      is_group: prototypeCommand.isGroup,
      lock_version: 1,
      manufacturer_id: rowId(manufacturer),
      merged_into_id: null,
      normalized_title: title.normalized,
      publication_status: 'draft',
      scale: optionalText(prototypeCommand.scale),
      stable_id: randomUUID(),
      title: title.raw,
      updated_at: now,
      updated_by_id: actorUserId,
      work_id: workId,
    })
    await replacePrototypeCharacters({
      actorUserId,
      characters: characters.map(({ input }) => input),
      isGroup: prototypeCommand.isGroup,
      prototypeId: rowId(row),
      reason: command.reason.trim(),
      transaction,
    })
    const result = resultFor('FigurePrototype', row, command.operationId, { status: 'draft' })
    return {
      after: await prototypeSnapshot(transaction, row),
      result,
      scopeStableId: result.stableId,
      scopeType: 'FigurePrototype',
    }
  }

  const beforeRow = await lockPrototypeByStableId(transaction, prototypeCommand.stableId, 'update')
  const before = await prototypeSnapshot(transaction, beforeRow)
  const patch: Record<string, unknown> = { updated_at: now, updated_by_id: actorUserId }

  if (prototypeCommand.type === 'updateFigurePrototype') {
    if (beforeRow.publication_status === 'archived') {
      throw new CatalogDomainError(
        'CATALOG_ENTITY_DELETED',
        'Archived prototypes must be restored first.',
        'conflict',
      )
    }
    if (prototypeCommand.title !== undefined) {
      const title = normalizeRequired(prototypeCommand.title, 'title')
      patch.title = title.raw
      patch.normalized_title = title.normalized
    }
    if (prototypeCommand.figureType !== undefined) patch.figure_type = prototypeCommand.figureType
    if (prototypeCommand.costumeText !== undefined)
      patch.costume_text = optionalText(prototypeCommand.costumeText)
    if (prototypeCommand.scale !== undefined) patch.scale = optionalText(prototypeCommand.scale)
    if (prototypeCommand.workStableId !== undefined) {
      patch.work_id = await resolveOptionalRelation(
        transaction,
        TABLES.works,
        prototypeCommand.workStableId,
      )
    }
    if (prototypeCommand.manufacturerStableId !== undefined) {
      patch.manufacturer_id = rowId(
        await resolveManufacturer(transaction, prototypeCommand.manufacturerStableId),
      )
    }
  } else if (prototypeCommand.type === 'setPrototypeCharacters') {
    await resolvePrototypeCharacters(
      transaction,
      prototypeCommand.characters,
      prototypeCommand.isGroup,
    )
    patch.is_group = prototypeCommand.isGroup
  } else if (prototypeCommand.type === 'reviewPrototypeAuthorization') {
    patch.authorization_status = prototypeCommand.authorizationStatus
    patch.authorization_evidence = prototypeCommand.authorizationEvidence ?? null
    patch.authorization_reason = command.reason.trim()
    patch.authorization_reviewed_at = now
    patch.authorization_reviewed_by_id = actorUserId
    if (prototypeCommand.authorizationStatus === 'rejected') {
      patch.inclusion_status = 'excluded'
      patch.inclusion_reason = command.reason.trim()
      patch.inclusion_reviewed_at = now
      patch.inclusion_reviewed_by_id = actorUserId
    }
  } else if (prototypeCommand.type === 'reviewPrototypeInclusion') {
    if (prototypeCommand.inclusionStatus === 'eligible')
      await assertPrototypeEligible(transaction, beforeRow)
    patch.inclusion_status = prototypeCommand.inclusionStatus
    patch.inclusion_reason = command.reason.trim()
    patch.inclusion_reviewed_at = now
    patch.inclusion_reviewed_by_id = actorUserId
  } else if (prototypeCommand.type === 'setPrototypePublicationStatus') {
    if (prototypeCommand.publicationStatus === 'published') {
      throw new CatalogDomainError(
        'FORMAL_MAIN_IMAGE_CAPABILITY_NOT_AVAILABLE',
        'Publication is unavailable until formal main images are implemented in PR-04.',
      )
    }
    if (prototypeCommand.publicationStatus === 'merged') {
      throw new CatalogDomainError(
        'MERGE_CAPABILITY_NOT_AVAILABLE',
        'Merged status is unavailable until PR-05.',
      )
    }
    if (
      prototypeCommand.publicationStatus === 'archived' ||
      beforeRow.publication_status === 'archived'
    ) {
      throw new CatalogDomainError(
        'CATALOG_TRANSITION_FORBIDDEN',
        'Use archivePrototype or restorePrototype so archive attribution remains atomic.',
        'conflict',
      )
    }
    const current = String(
      beforeRow.publication_status,
    ) as keyof typeof PR01_PROTOTYPE_STATUS_TRANSITIONS
    if (
      !transitionIsAllowed(
        PR01_PROTOTYPE_STATUS_TRANSITIONS,
        current,
        prototypeCommand.publicationStatus,
      )
    ) {
      throw new CatalogDomainError(
        'CATALOG_TRANSITION_FORBIDDEN',
        `Prototype cannot transition from ${current} to ${prototypeCommand.publicationStatus}.`,
        'conflict',
      )
    }
    patch.publication_status = prototypeCommand.publicationStatus
  } else if (prototypeCommand.type === 'archivePrototype') {
    if (beforeRow.publication_status === 'archived') {
      throw new CatalogDomainError(
        'CATALOG_TRANSITION_FORBIDDEN',
        'Prototype is already archived.',
        'conflict',
      )
    }
    patch.archived_at = now
    patch.archived_by_id = actorUserId
    patch.archive_reason = command.reason.trim()
    patch.inclusion_reason = command.reason.trim()
    patch.inclusion_reviewed_at = now
    patch.inclusion_reviewed_by_id = actorUserId
    patch.inclusion_status = 'excluded'
    patch.publication_status = 'archived'
  } else {
    if (beforeRow.publication_status !== 'archived') {
      throw new CatalogDomainError(
        'CATALOG_TRANSITION_FORBIDDEN',
        'Prototype is not archived.',
        'conflict',
      )
    }
    patch.archived_at = null
    patch.archived_by_id = null
    patch.archive_reason = null
    patch.publication_status = 'draft'
  }

  const row = await compareAndSwap(
    transaction,
    TABLES.figurePrototypes,
    prototypeCommand.stableId,
    prototypeCommand.expectedVersion,
    patch,
  )
  if (prototypeCommand.type === 'setPrototypeCharacters') {
    await replacePrototypeCharacters({
      actorUserId,
      characters: prototypeCommand.characters,
      isGroup: prototypeCommand.isGroup,
      prototypeId: rowId(row),
      reason: command.reason.trim(),
      transaction,
    })
  }
  if (row.inclusion_status === 'eligible') await assertPrototypeEligible(transaction, row)
  const result = resultFor('FigurePrototype', row, command.operationId, {
    status: String(row.publication_status),
  })
  return {
    after: await prototypeSnapshot(transaction, row),
    before,
    result,
    scopeStableId: result.stableId,
    scopeType: 'FigurePrototype',
  }
}

export async function executeVersionCommand(
  transaction: CatalogSqlTransaction,
  command: CatalogCommand,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome | null> {
  if (
    ![
      'createFigureVersion',
      'restoreFigureVersion',
      'softDeleteFigureVersion',
      'updateFigureVersion',
    ].includes(command.type)
  )
    return null
  const versionCommand = command as VersionCommand
  const now = new Date()

  if (versionCommand.type === 'createFigureVersion') {
    validateGrayModel(versionCommand.releaseStatus, versionCommand.grayModelCompleteness)
    const prototype = await lockPrototypeByStableId(
      transaction,
      versionCommand.prototypeStableId,
      'share',
    )
    assertPrototypeAcceptsVersionMutation(prototype)
    const name = normalizeRequired(versionCommand.name, 'name')
    const normalizedVersionKey = buildNormalizedVersionKey({
      channelOrDistributorLabel: versionCommand.channelOrDistributorLabel,
      kind: versionCommand.kind,
      name: name.raw,
    })
    await ensureUniqueVersionKey({
      normalizedVersionKey,
      prototypeId: rowId(prototype),
      transaction,
    })
    const row = await insertRow(transaction, TABLES.figureVersions, {
      channel_or_distributor_label: optionalText(versionCommand.channelOrDistributorLabel),
      created_at: now,
      created_by_id: actorUserId,
      deleted_at: null,
      deleted_by_id: null,
      delete_reason: null,
      gray_model_completeness: versionCommand.grayModelCompleteness,
      kind: versionCommand.kind,
      lock_version: 1,
      name: name.raw,
      normalized_version_key: normalizedVersionKey,
      notes: optionalText(versionCommand.notes),
      prototype_id: rowId(prototype),
      release_date: versionCommand.releaseDate ? new Date(versionCommand.releaseDate) : null,
      release_status: versionCommand.releaseStatus,
      sku_or_code: optionalText(versionCommand.skuOrCode),
      stable_id: randomUUID(),
      updated_at: now,
      updated_by_id: actorUserId,
    })
    const result = resultFor('FigureVersion', row, command.operationId, {
      status: String(row.release_status),
    })
    return {
      after: await versionSnapshot(transaction, row),
      result,
      scopeStableId: result.stableId,
      scopeType: 'FigureVersion',
    }
  }

  const beforeRow = await requireByStableId(
    transaction,
    TABLES.figureVersions,
    versionCommand.stableId,
    { allowDeleted: true },
  )
  const parentPrototype = await lockPrototypeByInternalId(
    transaction,
    beforeRow.prototype_id as number | string,
  )
  if (versionCommand.type !== 'softDeleteFigureVersion') {
    assertPrototypeAcceptsVersionMutation(parentPrototype)
  }
  const before = await versionSnapshot(transaction, beforeRow)
  const patch: Record<string, unknown> = { updated_at: now, updated_by_id: actorUserId }
  if (versionCommand.type === 'updateFigureVersion') {
    assertNotDeleted(beforeRow)
    const releaseStatus =
      versionCommand.releaseStatus ?? (String(beforeRow.release_status) as FigureReleaseStatus)
    const grayModelCompleteness =
      versionCommand.grayModelCompleteness ??
      (String(beforeRow.gray_model_completeness) as GrayModelCompleteness)
    validateGrayModel(releaseStatus, grayModelCompleteness)
    const name =
      versionCommand.name === undefined
        ? String(beforeRow.name)
        : normalizeRequired(versionCommand.name, 'name').raw
    const kind = versionCommand.kind ?? (String(beforeRow.kind) as FigureVersionKind)
    const channel =
      versionCommand.channelOrDistributorLabel === undefined
        ? optionalText(beforeRow.channel_or_distributor_label)
        : optionalText(versionCommand.channelOrDistributorLabel)
    const normalizedVersionKey = buildNormalizedVersionKey({
      channelOrDistributorLabel: channel,
      kind,
      name,
    })
    await ensureUniqueVersionKey({
      excludeStableId: versionCommand.stableId,
      normalizedVersionKey,
      prototypeId: beforeRow.prototype_id as number | string,
      transaction,
    })
    Object.assign(patch, {
      channel_or_distributor_label: channel,
      gray_model_completeness: grayModelCompleteness,
      kind,
      name,
      normalized_version_key: normalizedVersionKey,
      release_status: releaseStatus,
    })
    if (versionCommand.notes !== undefined) patch.notes = optionalText(versionCommand.notes)
    if (versionCommand.releaseDate !== undefined) {
      patch.release_date = versionCommand.releaseDate ? new Date(versionCommand.releaseDate) : null
    }
    if (versionCommand.skuOrCode !== undefined)
      patch.sku_or_code = optionalText(versionCommand.skuOrCode)
  } else if (versionCommand.type === 'softDeleteFigureVersion') {
    assertNotDeleted(beforeRow)
    patch.deleted_at = now
    patch.deleted_by_id = actorUserId
    patch.delete_reason = command.reason.trim()
  } else {
    assertDeleted(beforeRow)
    await ensureUniqueVersionKey({
      excludeStableId: versionCommand.stableId,
      normalizedVersionKey: String(beforeRow.normalized_version_key),
      prototypeId: beforeRow.prototype_id as number | string,
      transaction,
    })
    patch.deleted_at = null
    patch.deleted_by_id = null
    patch.delete_reason = null
  }

  const row = await compareAndSwap(
    transaction,
    TABLES.figureVersions,
    versionCommand.stableId,
    versionCommand.expectedVersion,
    patch,
  )
  await assertEligiblePrototypeStillValid(transaction, row.prototype_id as number | string)
  const result = resultFor('FigureVersion', row, command.operationId, {
    status: String(row.release_status),
  })
  return {
    after: await versionSnapshot(transaction, row),
    before,
    result,
    scopeStableId: result.stableId,
    scopeType: 'FigureVersion',
  }
}

export async function findPrototypeByStableId(
  transaction: CatalogSqlTransaction,
  stableId: string,
): Promise<CatalogRow | null> {
  return findByStableId(transaction, TABLES.figurePrototypes, stableId)
}
