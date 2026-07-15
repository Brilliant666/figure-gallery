import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  CatalogDomainError,
  normalizeCatalogName,
  type CatalogCommand,
} from '@figure-gallery/domain-contracts'
import { seedCatalog } from '@figure-gallery/test-fixtures'
import { getPayload, type PayloadRequest } from 'payload'

import config from '../../src/payload.config'
import { executeCatalogCommand } from '../../src/domain/catalog/services'

type TestResult = { evidence: string; name: string; status: 'pass' }
type SqlClient = {
  query: (text: string, values?: unknown[]) => Promise<unknown>
  release: () => void
}
type SqlPool = {
  connect: () => Promise<SqlClient>
  query: (text: string, values?: unknown[]) => Promise<unknown>
}

const results: TestResult[] = []

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function pass(name: string, evidence: string): void {
  results.push({ evidence, name, status: 'pass' })
}

async function expectDomainError(
  expectedCode: string,
  operation: () => Promise<unknown>,
): Promise<CatalogDomainError> {
  try {
    await operation()
  } catch (error) {
    if (error instanceof CatalogDomainError && error.code === expectedCode) return error
    throw error
  }
  throw new Error(`Expected ${expectedCode}.`)
}

async function expectDatabaseRejection(
  pool: SqlPool,
  statement: string,
  values: unknown[],
  expected: { code: string; constraint: string },
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    let rejection: unknown
    try {
      await client.query(statement, values)
    } catch (error) {
      rejection = error
    }
    await client.query('rollback')
    check(
      rejection && typeof rejection === 'object',
      'Expected PostgreSQL to reject the statement.',
    )
    const record = rejection as Record<string, unknown>
    check(
      record.code === expected.code && record.constraint === expected.constraint,
      `Expected PostgreSQL ${expected.code}/${expected.constraint}, received ${String(record.code)}/${String(record.constraint)}.`,
    )
  } finally {
    client.release()
  }
}

const payload = await getPayload({ config })

try {
  const email = process.env.PR01_ADMIN_EMAIL ?? 'catalog-admin@synthetic.invalid'
  const password = process.env.PR01_ADMIN_PASSWORD ?? 'Synthetic-PR01-Password-Only-42!'
  const existing = await payload.find({
    collection: 'users',
    limit: 1,
    overrideAccess: true,
    where: { email: { equals: email } },
  })
  const bootstrapReq = {
    context: { testOnlyBootstrap: 'pr01-ci' },
    payload,
    user: {
      collection: 'users' as const,
      email: 'pr01-ci-bootstrap@synthetic.invalid',
      id: 0,
    },
  } as unknown as PayloadRequest
  const admin =
    existing.docs[0] ??
    (await payload.create({
      collection: 'users',
      data: { email, password },
      overrideAccess: true,
      req: bootstrapReq,
    }))
  const req = {
    context: {},
    payload,
    user: { ...admin, collection: 'users' as const },
  } as unknown as PayloadRequest
  const execute = (command: CatalogCommand) => executeCatalogCommand(req, command)

  const firstSeed = await seedCatalog(execute)
  check(firstSeed.replayedOperations === 0, 'First seed must execute every command once.')
  const secondSeed = await seedCatalog(execute)
  check(
    secondSeed.replayedOperations === firstSeed.commands.length,
    'Second seed must replay every fixed operation ID.',
  )
  check(
    JSON.stringify(firstSeed.stableIds) === JSON.stringify(secondSeed.stableIds),
    'Idempotent seed must preserve every stable ID.',
  )
  pass(
    'synthetic-seed-idempotency',
    `${firstSeed.commands.length} commands replayed without duplicate roots`,
  )

  const collectionCounts = Object.fromEntries(
    await Promise.all(
      [
        'works',
        'characters',
        'character-aliases',
        'manufacturers',
        'figure-prototypes',
        'figure-prototype-characters',
        'figure-versions',
        'operation-logs',
      ].map(async (collection) => {
        const result = await payload.count({
          collection: collection as 'works',
          overrideAccess: true,
        })
        return [collection, result.totalDocs]
      }),
    ),
  )
  check(collectionCounts.works === 2, 'Fixture must create two Works.')
  check(collectionCounts.characters === 4, 'Fixture must create four Characters.')
  check(collectionCounts.manufacturers === 3, 'Fixture must create three Manufacturers.')
  check(collectionCounts['figure-prototypes'] === 5, 'Fixture must create five prototypes.')
  pass('formal-relations', JSON.stringify(collectionCounts))

  const ambiguousCharacters = await payload.find({
    collection: 'characters',
    depth: 0,
    limit: 10,
    overrideAccess: true,
    where: { normalizedName: { equals: normalizeCatalogName('Aster Vale') } },
  })
  check(ambiguousCharacters.totalDocs === 2, 'Same-name characters must coexist.')
  check(
    new Set(ambiguousCharacters.docs.map((doc) => doc.work)).size === 2,
    'Same-name characters must remain disambiguated by Work.',
  )
  check(
    ambiguousCharacters.docs.some((doc) =>
      doc.searchDocument.includes(normalizeCatalogName('星谷甲')),
    ),
    'Character searchDocument must include aliases.',
  )
  pass(
    'character-disambiguation',
    'two normalized-equal characters remain linked to distinct Works',
  )

  const sameTitlePrototypes = await payload.find({
    collection: 'figure-prototypes',
    depth: 0,
    limit: 10,
    overrideAccess: true,
    where: { normalizedTitle: { equals: normalizeCatalogName('Solar Arc Pose') } },
  })
  check(sameTitlePrototypes.totalDocs === 2, 'Same-title prototypes must coexist.')
  check(
    new Set(sameTitlePrototypes.docs.map((doc) => doc.manufacturer)).size === 2,
    'Same-title prototypes from different manufacturers must remain independent.',
  )
  pass(
    'manufacturer-prototype-identity',
    'same normalized title preserved under two manufacturer IDs',
  )

  const logsAfterSeed = await payload.count({ collection: 'operation-logs', overrideAccess: true })
  check(
    logsAfterSeed.totalDocs === firstSeed.commands.length,
    'Every successful seed command must append one OperationLog.',
  )
  pass('operation-log', `${logsAfterSeed.totalDocs} append-only audit records`)

  const auditedCommandTypes = [
    'createManufacturer',
    'createFigurePrototype',
    'createFigureVersion',
    'reviewPrototypeInclusion',
  ] as const
  const auditedCommands = auditedCommandTypes.map((type) => {
    const command = firstSeed.commands.find((candidate) => candidate.type === type)
    check(command, `Synthetic fixture must contain ${type}.`)
    return command
  })
  const auditedLogs = await payload.find({
    collection: 'operation-logs',
    depth: 0,
    limit: auditedCommands.length,
    overrideAccess: true,
    where: { operationId: { in: auditedCommands.map(({ operationId }) => operationId) } },
  })
  const auditByOperationId = new Map(auditedLogs.docs.map((log) => [log.operationId, log]))
  const snapshotFor = (type: (typeof auditedCommandTypes)[number]) => {
    const command = auditedCommands.find((candidate) => candidate.type === type)
    check(command, `Missing audited command ${type}.`)
    const log = auditByOperationId.get(command.operationId)
    check(log, `Missing OperationLog for ${type}.`)
    check(log.reversible === false, `${type} must be non-reversible in PR-01.`)
    check(
      log.afterSnapshot && typeof log.afterSnapshot === 'object',
      `${type} needs an after snapshot.`,
    )
    return { command, log, snapshot: log.afterSnapshot as Record<string, unknown> }
  }
  const manufacturerAudit = snapshotFor('createManufacturer')
  check(
    Array.isArray(manufacturerAudit.snapshot.aliases),
    'Manufacturer audit must include aliases.',
  )
  check(
    'officialSiteUrl' in manufacturerAudit.snapshot &&
      'sourceEvidence' in manufacturerAudit.snapshot,
    'Manufacturer audit must include mutable evidence fields.',
  )
  const prototypeAudit = snapshotFor('createFigurePrototype')
  check(
    Array.isArray(prototypeAudit.snapshot.characters) &&
      prototypeAudit.snapshot.characters.length > 0,
    'Prototype audit must include ordered Character relations.',
  )
  check(
    typeof prototypeAudit.snapshot.manufacturerStableId === 'string' &&
      'figureType' in prototypeAudit.snapshot &&
      'isGroup' in prototypeAudit.snapshot,
    'Prototype audit must use stable relation identity and include aggregate fields.',
  )
  const versionAudit = snapshotFor('createFigureVersion')
  check(
    typeof versionAudit.snapshot.prototypeStableId === 'string' &&
      typeof versionAudit.snapshot.normalizedVersionKey === 'string',
    'Version audit must include its parent stable ID and normalized key.',
  )
  const reviewAudit = snapshotFor('reviewPrototypeInclusion')
  check(
    reviewAudit.log.dutyContext === 'catalog_review',
    'Review commands need catalog_review duty.',
  )
  pass(
    'operation-log-snapshots',
    'aggregate snapshots, stable relations and review duty context persisted',
  )

  const duplicateWorkName = 'Synthetic Duplicate Warning Work'
  const firstDuplicateWork = await execute({
    displayName: duplicateWorkName,
    operationId: randomUUID(),
    reason: 'Create the first same-name Work warning fixture.',
    type: 'createWork',
  })
  check(
    firstDuplicateWork.result.warnings?.length === 0,
    'The first uniquely named Work must not emit a duplicate warning.',
  )
  const secondDuplicateWork = await execute({
    displayName: `  ${duplicateWorkName.toUpperCase()}  `,
    operationId: randomUUID(),
    reason: 'Create the second same-name Work warning fixture.',
    type: 'createWork',
  })
  check(
    secondDuplicateWork.result.warnings?.some(
      ({ code }) => code === 'WORK_NORMALIZED_NAME_DUPLICATE',
    ),
    'A same-normalized-name Work must save and emit the duplicate warning.',
  )
  pass('work-duplicate-warning', 'same normalized name saved with a non-blocking Admin warning')

  const firstFixtureCommand = firstSeed.commands[0]
  check(
    firstFixtureCommand?.type === 'createWork',
    'The first synthetic fixture command must create a Work.',
  )
  await expectDomainError('CATALOG_OPERATION_ID_CONFLICT', () =>
    execute({
      ...firstFixtureCommand,
      displayName: 'Changed replay payload must conflict',
    }),
  )
  const logsAfterReplayConflict = await payload.count({
    collection: 'operation-logs',
    overrideAccess: true,
  })
  check(
    logsAfterReplayConflict.totalDocs === logsAfterSeed.totalDocs,
    'A changed replay must not append another OperationLog.',
  )
  pass(
    'operation-idempotency',
    'same digest replayed; changed digest conflicted without another log',
  )

  const aliasOwner = secondSeed.results.characterAsterAurora
  await expectDomainError('CHARACTER_ALIAS_DUPLICATE', () =>
    execute({
      aliasType: 'translation',
      expectedVersion: aliasOwner.lockVersion,
      isPreferred: false,
      locale: 'zh-CN',
      operationId: randomUUID(),
      reason: 'Synthetic duplicate alias attack.',
      stableId: aliasOwner.stableId,
      type: 'addCharacterAlias',
      value: '星谷甲',
    }),
  )
  await expectDomainError('CHARACTER_ALIAS_PREFERRED_CONFLICT', () =>
    execute({
      aliasType: 'common',
      expectedVersion: aliasOwner.lockVersion,
      isPreferred: true,
      locale: 'zh-CN',
      operationId: randomUUID(),
      reason: 'Synthetic preferred alias collision attack.',
      stableId: aliasOwner.stableId,
      type: 'addCharacterAlias',
      value: 'Distinct preferred alias',
    }),
  )
  pass('character-alias-constraints', 'duplicate value and second preferred alias were rejected')

  const aliasLifecycleOwner = secondSeed.results.characterOrin
  const addedAlias = await execute({
    aliasType: 'translation',
    expectedVersion: aliasLifecycleOwner.lockVersion,
    isPreferred: false,
    locale: 'fr',
    operationId: randomUUID(),
    reason: 'Add an alias for deterministic search-document lifecycle testing.',
    stableId: aliasLifecycleOwner.stableId,
    type: 'addCharacterAlias',
    value: 'Alias Before Update',
  })
  check(addedAlias.result.relatedStableId, 'Alias create must return its stable ID.')
  const characterAfterAliasAdd = await payload.find({
    collection: 'characters',
    limit: 1,
    overrideAccess: true,
    where: { stableId: { equals: aliasLifecycleOwner.stableId } },
  })
  check(
    characterAfterAliasAdd.docs[0]?.searchDocument.includes(
      normalizeCatalogName('Alias Before Update'),
    ),
    'Adding an alias must rebuild searchDocument.',
  )
  const updatedAlias = await execute({
    aliasStableId: addedAlias.result.relatedStableId,
    expectedVersion: addedAlias.result.lockVersion,
    operationId: randomUUID(),
    reason: 'Update the alias and rebuild the search document.',
    stableId: aliasLifecycleOwner.stableId,
    type: 'updateCharacterAlias',
    value: 'Alias After Update',
  })
  const characterAfterAliasUpdate = await payload.find({
    collection: 'characters',
    limit: 1,
    overrideAccess: true,
    where: { stableId: { equals: aliasLifecycleOwner.stableId } },
  })
  check(
    characterAfterAliasUpdate.docs[0]?.searchDocument.includes(
      normalizeCatalogName('Alias After Update'),
    ) &&
      !characterAfterAliasUpdate.docs[0]?.searchDocument.includes(
        normalizeCatalogName('Alias Before Update'),
      ),
    'Updating an alias must replace the derived search term.',
  )
  const removedAlias = await execute({
    aliasStableId: addedAlias.result.relatedStableId,
    expectedVersion: updatedAlias.result.lockVersion,
    operationId: randomUUID(),
    reason: 'Remove the alias and rebuild the search document.',
    stableId: aliasLifecycleOwner.stableId,
    type: 'removeCharacterAlias',
  })
  const characterAfterAliasRemoval = await payload.find({
    collection: 'characters',
    limit: 1,
    overrideAccess: true,
    where: { stableId: { equals: aliasLifecycleOwner.stableId } },
  })
  check(
    !characterAfterAliasRemoval.docs[0]?.searchDocument.includes(
      normalizeCatalogName('Alias After Update'),
    ),
    'Removing an alias must remove the derived search term.',
  )
  check(
    removedAlias.result.lockVersion === aliasLifecycleOwner.lockVersion + 3,
    'Alias lifecycle must advance the Character aggregate version exactly once per command.',
  )
  pass(
    'character-alias-lifecycle',
    'add/update/remove atomically rebuilt searchDocument and root version',
  )

  const reviewedPrototypes = await payload.find({
    collection: 'figure-prototypes',
    limit: 10,
    overrideAccess: true,
    where: {
      stableId: {
        in: [
          secondSeed.stableIds.prototypeGroup,
          secondSeed.stableIds.prototypeRejected,
          secondSeed.stableIds.prototypeThirdParty,
        ],
      },
    },
  })
  const reviewedByStableId = new Map(
    reviewedPrototypes.docs.map((prototype) => [prototype.stableId, prototype]),
  )
  const thirdParty = reviewedByStableId.get(secondSeed.stableIds.prototypeThirdParty)
  const rejectedPrototype = reviewedByStableId.get(secondSeed.stableIds.prototypeRejected)
  const groupPrototype = reviewedByStableId.get(secondSeed.stableIds.prototypeGroup)
  check(
    thirdParty?.authorizationStatus === 'authorized_third_party' &&
      thirdParty.inclusionStatus === 'eligible',
    'Authorized third-party fixture must become eligible.',
  )
  check(
    rejectedPrototype?.authorizationStatus === 'rejected' &&
      rejectedPrototype.inclusionStatus === 'excluded',
    'Rejected fixture must also be excluded.',
  )
  check(groupPrototype?.isGroup === true, 'Group fixture must retain isGroup=true.')
  const groupRelations = await payload.find({
    collection: 'figure-prototype-characters',
    depth: 0,
    limit: 10,
    overrideAccess: true,
    where: { prototype: { equals: groupPrototype?.id } },
  })
  check(groupRelations.totalDocs === 2, 'Group fixture must retain two Character relations.')
  check(
    groupRelations.docs.filter(({ role }) => role === 'primary').length === 1,
    'Group fixture must retain exactly one primary Character.',
  )
  pass(
    'prototype-review-and-relations',
    'third-party, rejected, group and single-primary rules persisted',
  )

  const work = secondSeed.results.workFrontier
  const concurrentCommands: CatalogCommand[] = [
    {
      displayName: 'Lattice Frontier Concurrent Alpha',
      expectedVersion: work.lockVersion,
      operationId: randomUUID(),
      reason: 'Synthetic optimistic concurrency branch alpha.',
      stableId: work.stableId,
      type: 'updateWork',
    },
    {
      displayName: 'Lattice Frontier Concurrent Beta',
      expectedVersion: work.lockVersion,
      operationId: randomUUID(),
      reason: 'Synthetic optimistic concurrency branch beta.',
      stableId: work.stableId,
      type: 'updateWork',
    },
  ]
  const concurrent = await Promise.allSettled(concurrentCommands.map(execute))
  check(
    concurrent.filter((item) => item.status === 'fulfilled').length === 1,
    'Exactly one CAS update must win.',
  )
  const rejected = concurrent.find((item) => item.status === 'rejected')
  check(
    rejected?.status === 'rejected' &&
      rejected.reason instanceof CatalogDomainError &&
      rejected.reason.code === 'CATALOG_VERSION_CONFLICT',
    'The losing CAS update must return CATALOG_VERSION_CONFLICT.',
  )
  pass('optimistic-concurrency', 'one winner and one stable 409-domain conflict')

  const lifecycleWorkDraft = await execute({
    displayName: 'Synthetic Lifecycle Work',
    operationId: randomUUID(),
    reason: 'Create an isolated Work lifecycle fixture.',
    type: 'createWork',
    workType: 'game',
  })
  const lifecycleWorkUpdated = await execute({
    displayName: 'Synthetic Lifecycle Work Updated',
    expectedVersion: lifecycleWorkDraft.result.lockVersion,
    operationId: randomUUID(),
    reason: 'Update and explicitly reset the Work type.',
    stableId: lifecycleWorkDraft.result.stableId,
    type: 'updateWork',
    workType: null,
  })
  const lifecycleWorkPublished = await execute({
    expectedVersion: lifecycleWorkUpdated.result.lockVersion,
    operationId: randomUUID(),
    publicationStatus: 'published',
    reason: 'Publish the isolated Work lifecycle fixture.',
    stableId: lifecycleWorkDraft.result.stableId,
    type: 'setWorkPublicationStatus',
  })
  const lifecycleWorkDeleted = await execute({
    expectedVersion: lifecycleWorkPublished.result.lockVersion,
    operationId: randomUUID(),
    reason: 'Soft-delete the isolated Work lifecycle fixture.',
    stableId: lifecycleWorkDraft.result.stableId,
    type: 'softDeleteWork',
  })
  await expectDomainError('CATALOG_ENTITY_DELETED', () =>
    execute({
      displayName: 'Forbidden deleted Work update',
      expectedVersion: lifecycleWorkDeleted.result.lockVersion,
      operationId: randomUUID(),
      reason: 'Verify that deleted Works require explicit restore.',
      stableId: lifecycleWorkDraft.result.stableId,
      type: 'updateWork',
    }),
  )
  const lifecycleWorkRestored = await execute({
    expectedVersion: lifecycleWorkDeleted.result.lockVersion,
    operationId: randomUUID(),
    reason: 'Restore the isolated Work lifecycle fixture.',
    stableId: lifecycleWorkDraft.result.stableId,
    type: 'restoreWork',
  })
  const lifecycleWork = await payload.find({
    collection: 'works',
    limit: 1,
    overrideAccess: true,
    where: { stableId: { equals: lifecycleWorkRestored.result.stableId } },
  })
  check(
    lifecycleWork.docs[0]?.workType === 'other',
    'Explicit Work type reset must persist as other.',
  )
  check(
    lifecycleWork.docs[0]?.publicationStatus === 'published' && !lifecycleWork.docs[0]?.deletedAt,
    'Restored Work must retain its publication state and clear deletion fields.',
  )
  await expectDomainError('CATALOG_TRANSITION_FORBIDDEN', () =>
    execute({
      expectedVersion: lifecycleWorkRestored.result.lockVersion,
      operationId: randomUUID(),
      publicationStatus: 'published',
      reason: 'Verify that an unlisted self-transition is rejected.',
      stableId: lifecycleWorkDraft.result.stableId,
      type: 'setWorkPublicationStatus',
    }),
  )
  pass('work-lifecycle', 'update/status/soft-delete/restore and deleted-write rejection passed')

  const protectedCharacter = await payload.find({
    collection: 'characters',
    limit: 1,
    overrideAccess: true,
    where: { stableId: { equals: secondSeed.stableIds.characterAsterAurora } },
  })
  const protectedBefore = protectedCharacter.docs[0]
  check(protectedBefore, 'Protected Character must exist.')
  const hiddenProtectedCharacter = await execute({
    expectedVersion: protectedBefore.lockVersion,
    operationId: randomUUID(),
    reason: 'Hide an undeleted Character without invalidating catalog eligibility.',
    stableId: protectedBefore.stableId,
    status: 'hidden',
    type: 'setCharacterStatus',
  })
  await expectDomainError('CHARACTER_IN_USE_BY_ELIGIBLE_PROTOTYPE', () =>
    execute({
      expectedVersion: hiddenProtectedCharacter.result.lockVersion,
      operationId: randomUUID(),
      reason: 'Synthetic rollback test for eligible prototype dependency.',
      stableId: protectedBefore.stableId,
      type: 'softDeleteCharacter',
    }),
  )
  const protectedAfter = await payload.find({
    collection: 'characters',
    limit: 1,
    overrideAccess: true,
    where: { stableId: { equals: protectedBefore.stableId } },
  })
  check(
    protectedAfter.docs[0]?.lockVersion === hiddenProtectedCharacter.result.lockVersion,
    'Rollback must restore lockVersion.',
  )
  check(!protectedAfter.docs[0]?.deletedAt, 'Rollback must restore deletion state.')
  check(
    protectedAfter.docs[0]?.status === 'hidden',
    'Hidden but undeleted Character must remain eligible.',
  )
  pass(
    'transaction-rollback',
    'hidden Character remained eligible while failed deletion left version and state unchanged',
  )

  const eligiblePrototype = secondSeed.results.prototypeSolarArcA
  await expectDomainError('FORMAL_MAIN_IMAGE_CAPABILITY_NOT_AVAILABLE', () =>
    execute({
      expectedVersion: eligiblePrototype.lockVersion,
      operationId: randomUUID(),
      publicationStatus: 'published',
      reason: 'Synthetic PR-01 publication placeholder test.',
      stableId: eligiblePrototype.stableId,
      type: 'setPrototypePublicationStatus',
    }),
  )
  await expectDomainError('MERGE_CAPABILITY_NOT_AVAILABLE', () =>
    execute({
      expectedVersion: eligiblePrototype.lockVersion,
      operationId: randomUUID(),
      publicationStatus: 'merged',
      reason: 'Synthetic PR-01 merge placeholder test.',
      stableId: eligiblePrototype.stableId,
      type: 'setPrototypePublicationStatus',
    }),
  )
  pass('publication-placeholders', 'published and merged rejected with fixed capability codes')

  await expectDomainError('MANUFACTURER_IN_USE_BY_ELIGIBLE_PROTOTYPE', () =>
    execute({
      expectedVersion: secondSeed.results.manufacturerActive.lockVersion,
      operationId: randomUUID(),
      reason: 'Synthetic active manufacturer dependency test.',
      stableId: secondSeed.results.manufacturerActive.stableId,
      status: 'hidden',
      type: 'setManufacturerStatus',
    }),
  )
  pass(
    'manufacturer-eligibility-guard',
    'eligible prototype prevents hiding its active manufacturer',
  )

  await expectDomainError('PROTOTYPE_GROUP_FLAG_INVALID', () =>
    execute({
      characters: [
        {
          characterStableId: secondSeed.stableIds.characterNila,
          displayOrder: 0,
          role: 'primary',
        },
        {
          characterStableId: secondSeed.stableIds.characterOrin,
          displayOrder: 1,
          role: 'secondary',
        },
      ],
      figureType: 'scale',
      isGroup: false,
      manufacturerStableId: secondSeed.stableIds.manufacturerActive,
      operationId: randomUUID(),
      reason: 'Synthetic group invariant attack.',
      title: 'Invalid Group Flag Pose',
      type: 'createFigurePrototype',
    }),
  )
  pass('prototype-character-invariants', 'service rejected multiple characters without isGroup')

  const draftManufacturerPrototype = await execute({
    characters: [
      {
        characterStableId: secondSeed.stableIds.characterOrin,
        displayOrder: 0,
        role: 'primary',
      },
    ],
    figureType: 'prize',
    isGroup: false,
    manufacturerStableId: secondSeed.stableIds.manufacturerDraft,
    operationId: randomUUID(),
    reason: 'Synthetic draft manufacturer eligibility test.',
    title: 'Draft Manufacturer Eligibility Pose',
    type: 'createFigurePrototype',
  })
  await execute({
    grayModelCompleteness: 'not_applicable',
    kind: 'regular',
    name: 'Draft Manufacturer Qualifying Version',
    operationId: randomUUID(),
    prototypeStableId: draftManufacturerPrototype.result.stableId,
    reason: 'Synthetic qualifying version under a draft manufacturer.',
    releaseStatus: 'released',
    type: 'createFigureVersion',
  })
  const draftManufacturerAuthorized = await execute({
    authorizationEvidence: { fixture: true },
    authorizationStatus: 'official',
    expectedVersion: draftManufacturerPrototype.result.lockVersion,
    operationId: randomUUID(),
    reason: 'Synthetic official authorization with draft manufacturer.',
    stableId: draftManufacturerPrototype.result.stableId,
    type: 'reviewPrototypeAuthorization',
  })
  await expectDomainError('MANUFACTURER_NOT_ACTIVE', () =>
    execute({
      expectedVersion: draftManufacturerAuthorized.result.lockVersion,
      inclusionStatus: 'eligible',
      operationId: randomUUID(),
      reason: 'Synthetic attempt to bypass draft manufacturer gate.',
      stableId: draftManufacturerAuthorized.result.stableId,
      type: 'reviewPrototypeInclusion',
    }),
  )

  const partialGrayPrototype = await execute({
    characters: [
      {
        characterStableId: secondSeed.stableIds.characterOrin,
        displayOrder: 0,
        role: 'primary',
      },
    ],
    figureType: 'scale',
    isGroup: false,
    manufacturerStableId: secondSeed.stableIds.manufacturerActive,
    operationId: randomUUID(),
    reason: 'Synthetic incomplete gray eligibility test.',
    title: 'Incomplete Gray Eligibility Pose',
    type: 'createFigurePrototype',
  })
  const partialGrayVersion = await execute({
    grayModelCompleteness: 'partial',
    kind: 'regular',
    name: 'Incomplete Gray Only Version',
    operationId: randomUUID(),
    prototypeStableId: partialGrayPrototype.result.stableId,
    reason: 'Synthetic partial gray version.',
    releaseStatus: 'gray_prototype',
    type: 'createFigureVersion',
  })
  const partialGrayAuthorized = await execute({
    authorizationEvidence: { fixture: true },
    authorizationStatus: 'official',
    expectedVersion: partialGrayPrototype.result.lockVersion,
    operationId: randomUUID(),
    reason: 'Synthetic authorization before gray eligibility check.',
    stableId: partialGrayPrototype.result.stableId,
    type: 'reviewPrototypeAuthorization',
  })
  await expectDomainError('PROTOTYPE_ELIGIBILITY_NOT_MET', () =>
    execute({
      expectedVersion: partialGrayAuthorized.result.lockVersion,
      inclusionStatus: 'eligible',
      operationId: randomUUID(),
      reason: 'Synthetic attempt to include incomplete gray model.',
      stableId: partialGrayAuthorized.result.stableId,
      type: 'reviewPrototypeInclusion',
    }),
  )
  pass(
    'eligibility-negative-cases',
    'draft manufacturer and partial gray model could not become eligible',
  )

  await execute({
    expectedVersion: partialGrayAuthorized.result.lockVersion,
    operationId: randomUUID(),
    reason: 'Archive the isolated incomplete-gray prototype.',
    stableId: partialGrayPrototype.result.stableId,
    type: 'archivePrototype',
  })
  await expectDomainError('CATALOG_ENTITY_DELETED', () =>
    execute({
      grayModelCompleteness: 'not_applicable',
      kind: 'bonus',
      name: 'Forbidden Version Under Archived Prototype',
      operationId: randomUUID(),
      prototypeStableId: partialGrayPrototype.result.stableId,
      reason: 'Verify archived parent blocks new versions.',
      releaseStatus: 'announced',
      type: 'createFigureVersion',
    }),
  )
  await expectDomainError('CATALOG_ENTITY_DELETED', () =>
    execute({
      expectedVersion: partialGrayVersion.result.lockVersion,
      notes: 'Forbidden update under archived parent.',
      operationId: randomUUID(),
      reason: 'Verify archived parent blocks ordinary version updates.',
      stableId: partialGrayVersion.result.stableId,
      type: 'updateFigureVersion',
    }),
  )
  pass('archived-prototype-version-guard', 'archived parent blocked Version create and update')

  await expectDomainError('FIGURE_VERSION_DUPLICATE', () =>
    execute({
      grayModelCompleteness: 'not_applicable',
      kind: 'regular',
      name: 'Solar Arc Regular',
      operationId: randomUUID(),
      prototypeStableId: secondSeed.stableIds.prototypeSolarArcA,
      reason: 'Synthetic duplicate version attack.',
      releaseStatus: 'released',
      type: 'createFigureVersion',
    }),
  )
  pass('version-composite-identity', 'active prototype/version normalized key rejected duplicate')

  const fakeReq = {
    context: { catalogDomainWriteCapability: true },
    payload,
  } as unknown as PayloadRequest
  let localBypassRejected = false
  try {
    await payload.create({
      collection: 'works',
      data: {
        createdBy: admin.id,
        displayName: 'Bypass Work',
        lockVersion: 1,
        normalizedName: 'bypass work',
        publicationStatus: 'draft',
        stableId: randomUUID(),
        updatedBy: admin.id,
        workType: 'other',
      },
      overrideAccess: true,
      req: fakeReq,
    })
  } catch {
    localBypassRejected = true
  }
  check(localBypassRejected, 'Local API overrideAccess attack must be rejected.')

  let localUpdateRejected = false
  try {
    const attackWorkId = ambiguousCharacters.docs[0]?.work
    check(typeof attackWorkId === 'number', 'Synthetic Character must expose a depth-zero Work ID.')
    await payload.update({
      collection: 'works',
      data: { stableId: randomUUID() },
      id: attackWorkId,
      overrideAccess: true,
      req: fakeReq,
    })
  } catch {
    localUpdateRejected = true
  }
  check(localUpdateRejected, 'Local API stableId mutation attack must be rejected.')

  let localDeleteRejected = false
  try {
    const workDocument = await payload.find({
      collection: 'works',
      limit: 1,
      overrideAccess: true,
      where: { stableId: { equals: secondSeed.stableIds.workAurora } },
    })
    check(workDocument.docs[0], 'Synthetic Work must exist for Local API delete attack.')
    await payload.delete({
      collection: 'works',
      id: workDocument.docs[0].id,
      overrideAccess: true,
      req: fakeReq,
    })
  } catch {
    localDeleteRejected = true
  }
  check(localDeleteRejected, 'Local API delete attack must be rejected.')
  const immutableLog = auditedLogs.docs[0]
  check(immutableLog, 'An OperationLog must exist for append-only attacks.')
  let operationLogUpdateRejected = false
  try {
    await payload.update({
      collection: 'operation-logs',
      data: { reason: 'Forbidden audit rewrite.' },
      id: immutableLog.id,
      overrideAccess: true,
      req: fakeReq,
    })
  } catch {
    operationLogUpdateRejected = true
  }
  check(
    operationLogUpdateRejected,
    'OperationLog update must be rejected even with overrideAccess.',
  )
  let operationLogDeleteRejected = false
  try {
    await payload.delete({
      collection: 'operation-logs',
      id: immutableLog.id,
      overrideAccess: true,
      req: fakeReq,
    })
  } catch {
    operationLogDeleteRejected = true
  }
  check(
    operationLogDeleteRejected,
    'OperationLog delete must be rejected even with overrideAccess.',
  )
  const bypassRows = await payload.find({
    collection: 'works',
    limit: 1,
    overrideAccess: true,
    where: { displayName: { equals: 'Bypass Work' } },
  })
  check(bypassRows.totalDocs === 0, 'Rejected Local API attack must not persist a row.')
  pass(
    'local-api-bypass',
    'catalog and OperationLog create/update/delete overrideAccess plus forged string context were rejected',
  )

  const pool = payload.db.pool
  const restrictedCatalogForeignKeys = [
    'character_aliases_character_id_characters_id_fk',
    'characters_work_id_works_id_fk',
    'figure_prototype_characters_character_id_characters_id_fk',
    'figure_prototype_characters_prototype_id_figure_prototypes_id_fk',
    'figure_prototypes_manufacturer_id_manufacturers_id_fk',
    'figure_prototypes_merged_into_id_figure_prototypes_id_fk',
    'figure_prototypes_work_id_works_id_fk',
    'figure_versions_prototype_id_figure_prototypes_id_fk',
  ]
  const foreignKeyPolicies = await pool.query<{ confdeltype: string; conname: string }>(
    `select conname, confdeltype
       from pg_constraint
       where conname = any($1::text[])
       order by conname`,
    [restrictedCatalogForeignKeys],
  )
  check(
    foreignKeyPolicies.rows.length === restrictedCatalogForeignKeys.length &&
      foreignKeyPolicies.rows.every(({ confdeltype }) => confdeltype === 'r'),
    'All eight formal catalog foreign keys must use ON DELETE RESTRICT.',
  )
  pass('postgres-foreign-key-policy', '8/8 formal catalog references use ON DELETE RESTRICT')

  await expectDatabaseRejection(
    pool,
    `insert into works (stable_id, display_name, normalized_name, work_type, publication_status, lock_version, created_by_id, updated_by_id) values ($1, 'duplicate stable identity', 'duplicate stable identity', 'other', 'draft', 1, $2, $2)`,
    [secondSeed.stableIds.workAurora, admin.id],
    { code: '23505', constraint: 'works_stable_id_idx' },
  )
  await expectDatabaseRejection(
    pool,
    `insert into works (stable_id, display_name, normalized_name, work_type, publication_status, lock_version, created_by_id, updated_by_id) values ($1, 'invalid', 'invalid', 'other', 'draft', 1, $2, $2)`,
    ['not-a-uuid', admin.id],
    { code: '23514', constraint: 'works_stable_id_uuid_chk' },
  )
  await expectDatabaseRejection(
    pool,
    `update figure_prototypes set publication_status = 'published' where stable_id = $1`,
    [secondSeed.stableIds.prototypeSolarArcA],
    { code: '23514', constraint: 'figure_prototypes_publication_unavailable_chk' },
  )
  await expectDatabaseRejection(
    pool,
    `update figure_prototypes set adult_entry_flag = true where stable_id = $1`,
    [secondSeed.stableIds.prototypeSolarArcA],
    { code: '23514', constraint: 'figure_prototypes_adult_entry_false_chk' },
  )
  await expectDatabaseRejection(
    pool,
    `update figure_versions set gray_model_completeness = 'partial' where stable_id = $1`,
    [secondSeed.stableIds.versionRegular],
    { code: '23514', constraint: 'figure_versions_gray_completeness_chk' },
  )
  await expectDatabaseRejection(
    pool,
    `update works set lock_version = 0 where stable_id = $1`,
    [secondSeed.stableIds.workAurora],
    { code: '23514', constraint: 'works_lock_version_positive_chk' },
  )
  await expectDatabaseRejection(
    pool,
    `update works set deleted_at = now(), deleted_by_id = null, delete_reason = null where stable_id = $1`,
    [secondSeed.stableIds.workAurora],
    { code: '23514', constraint: 'works_soft_delete_attribution_chk' },
  )
  const forbiddenPrototypeMediaColumns = await pool.query<{ column_name: string }>(`
    select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'figure_prototypes'
        and column_name ~* '(media|image)'
  `)
  check(
    forbiddenPrototypeMediaColumns.rows.length === 0,
    'PR-01 FigurePrototype must not contain technical Media or main-image fields.',
  )
  pass(
    'postgres-constraints',
    'stable UUID uniqueness/format, positive locks, soft-delete attribution, publication, adult, gray and no-technical-media checks passed',
  )

  const output = process.env.PR01_INTEGRATION_OUTPUT
  if (output) {
    mkdirSync(path.dirname(output), { recursive: true })
    writeFileSync(
      output,
      `${JSON.stringify(
        {
          collectionCounts,
          generatedAt: new Date().toISOString(),
          hpoiRequests: 0,
          resultCount: results.length,
          results,
          schemaVersion: 1,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  }
  process.stdout.write(`PR-01 catalog integration passed (${results.length} checks).\n`)
} finally {
  await payload.destroy()
}

// Payload's PostgreSQL adapter retains an idle connection after destroy(). This is an
// intentionally one-shot CI probe, so terminate only after the complete success path.
process.exit(0)
