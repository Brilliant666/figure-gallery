import { createHash, randomUUID } from 'node:crypto'

import {
  buildCharacterSearchDocument,
  normalizeCatalogName,
} from '@figure-gallery/domain-contracts'
import type { Payload, PayloadRequest } from 'payload'

import type {
  CatalogItem,
  Character,
  CharacterAlias,
  FigurePrototype,
  FigurePrototypeCharacter,
  OperationLog,
  SourceRecord,
  User,
} from '../payload-types'
import { withCatalogDomainWrite } from '../domain/catalog/internal-context'
import {
  canonicalStringify,
  createFormalBridgeBundle,
  FormalBridgeError,
  validateFormalBridgeBundle,
  type FormalBridgeBundle,
  type FormalBridgeCatalogItem,
  type FormalBridgeFigurePrototype,
  type FormalBridgeImageRef,
  type FormalBridgeSourceRecord,
} from './export'

const BRIDGE_ACTOR_EMAIL = 'formal-catalog-bridge@synthetic.invalid'
const BRIDGE_KEY_LOCALE = 'x-formal-bridge-key'
const BRIDGE_ALIAS_LOCALE = 'x-formal-bridge-alias'

type DocumentId = number | string

export interface FormalBridgeEntityImportResult {
  inserted: number
  unchanged: number
  updated: number
}

export interface FormalBridgeImportSummary {
  catalogItems: FormalBridgeEntityImportResult
  characterAliases: FormalBridgeEntityImportResult
  characters: FormalBridgeEntityImportResult
  contentDigest: string
  errors: number
  figurePrototypeCharacters: FormalBridgeEntityImportResult
  figurePrototypes: FormalBridgeEntityImportResult
  operationLogInserted: number
  sourceRecords: FormalBridgeEntityImportResult
  unintendedUpdates: number
}

function emptyResult(): FormalBridgeEntityImportResult {
  return { inserted: 0, unchanged: 0, updated: 0 }
}

function createSummary(contentDigest: string): FormalBridgeImportSummary {
  return {
    catalogItems: emptyResult(),
    characterAliases: emptyResult(),
    characters: emptyResult(),
    contentDigest,
    errors: 0,
    figurePrototypeCharacters: emptyResult(),
    figurePrototypes: emptyResult(),
    operationLogInserted: 0,
    sourceRecords: emptyResult(),
    unintendedUpdates: 0,
  }
}

function relationId(value: unknown, type: string, key: string, field: string): DocumentId {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  throw new FormalBridgeError('formal-import', type, key, `${field} has no relationship ID.`)
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

function normalizeImageRefs(value: CatalogItem['imageRefs']): FormalBridgeImageRef[] {
  return (value ?? [])
    .map((image) => ({
      catalogItemKey: image.catalogItemKey,
      imageRefKey: image.imageRefKey,
      isMain: image.isMain,
      sourceFamily: image.sourceFamily as FormalBridgeImageRef['sourceFamily'],
      url: image.url,
    }))
    .sort((left, right) => left.imageRefKey.localeCompare(right.imageRefKey))
}

async function recordOperation<T>(
  phase: string,
  recordType: string,
  stableKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof FormalBridgeError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new FormalBridgeError(phase, recordType, stableKey, message)
  }
}

function uuidFromDigest(digest: string): string {
  const bytes = Buffer.from(
    createHash('sha256').update(`formal-catalog-bridge:${digest}`).digest('hex').slice(0, 32),
    'hex',
  )
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function ensureBridgeActor(payload: Payload): Promise<User> {
  const existing = await payload.find({
    collection: 'users',
    limit: 2,
    overrideAccess: true,
    where: { email: { equals: BRIDGE_ACTOR_EMAIL } },
  })
  if (existing.totalDocs > 1) {
    throw new FormalBridgeError(
      'formal-import',
      'User',
      BRIDGE_ACTOR_EMAIL,
      'More than one technical bridge actor exists.',
    )
  }
  if (existing.docs[0]) return existing.docs[0]

  const bootstrapReq = {
    context: { formalBridgeBootstrap: true },
    payload,
    user: {
      collection: 'users' as const,
      email: 'formal-bridge-bootstrap@synthetic.invalid',
      id: 0,
    },
  } as unknown as PayloadRequest

  return payload.create({
    collection: 'users',
    data: { email: BRIDGE_ACTOR_EMAIL, password: `${randomUUID()}-${randomUUID()}` },
    overrideAccess: true,
    req: bootstrapReq,
  })
}

function requestFor(payload: Payload, actor: User): PayloadRequest {
  return {
    context: { formalCatalogBridge: true },
    payload,
    user: { ...actor, collection: 'users' as const },
  } as unknown as PayloadRequest
}

async function findBridgeAliases(payload: Payload): Promise<CharacterAlias[]> {
  const result = await payload.find({
    collection: 'character-aliases',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: { locale: { in: [BRIDGE_KEY_LOCALE, BRIDGE_ALIAS_LOCALE] } },
  })
  return result.docs.filter((alias) => !alias.deletedAt)
}

async function findCharactersByNormalizedName(
  payload: Payload,
  names: string[],
): Promise<Character[]> {
  const result = await payload.find({
    collection: 'characters',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: { normalizedName: { in: names } },
  })
  return result.docs.filter((character) => !character.deletedAt)
}

async function importCharacters(input: {
  actor: User
  bundle: FormalBridgeBundle
  payload: Payload
  req: PayloadRequest
  summary: FormalBridgeImportSummary
}): Promise<Map<string, Character>> {
  const aliases = await findBridgeAliases(input.payload)
  const characterById = new Map<DocumentId, Character>()
  const keyAliasByKey = new Map(
    aliases
      .filter((alias) => alias.locale === BRIDGE_KEY_LOCALE)
      .map((alias) => [alias.value, alias]),
  )
  const candidates = await findCharactersByNormalizedName(
    input.payload,
    input.bundle.characters.map((character) => normalizeCatalogName(character.displayName)),
  )
  for (const candidate of candidates) characterById.set(candidate.id, candidate)

  const result = new Map<string, Character>()
  for (const character of input.bundle.characters) {
    const keyAlias = keyAliasByKey.get(character.characterKey)
    let document: Character | undefined
    if (keyAlias) {
      document = characterById.get(
        relationId(keyAlias.character, 'CharacterAlias', character.characterKey, 'character'),
      )
      if (!document) {
        const found = await input.payload.findByID({
          collection: 'characters',
          depth: 0,
          id: relationId(keyAlias.character, 'CharacterAlias', character.characterKey, 'character'),
          overrideAccess: true,
        })
        if (!found.deletedAt) document = found
      }
    }

    if (!document) {
      const normalizedName = normalizeCatalogName(character.displayName)
      const matching = candidates.filter((candidate) => candidate.normalizedName === normalizedName)
      if (matching.length > 1) {
        throw new FormalBridgeError(
          'formal-import',
          'Character',
          character.characterKey,
          'Character normalizedName is ambiguous; the importer will not guess.',
        )
      }
      document = matching[0]
    }

    if (document) {
      if (document.displayName !== character.displayName) {
        throw new FormalBridgeError(
          'formal-import',
          'Character',
          character.characterKey,
          'Existing Character displayName conflicts with the bridge export.',
        )
      }
      input.summary.characters.unchanged += 1
    } else {
      document = await recordOperation('formal-import', 'Character', character.characterKey, () =>
        input.payload.create({
          collection: 'characters',
          data: {
            createdBy: input.actor.id,
            displayName: character.displayName,
            lockVersion: 1,
            normalizedName: normalizeCatalogName(character.displayName),
            searchDocument: buildCharacterSearchDocument({
              aliases: character.aliases,
              displayName: character.displayName,
            }),
            status: 'matching_pending',
            updatedBy: input.actor.id,
          } as never,
          overrideAccess: true,
          req: input.req,
        }),
      )
      input.summary.characters.inserted += 1
      candidates.push(document)
      characterById.set(document.id, document)
    }
    result.set(character.characterKey, document)
  }

  for (const character of input.bundle.characters) {
    const document = result.get(character.characterKey)
    if (!document) throw new Error(`Missing imported character ${character.characterKey}.`)
    const desiredAliases = [
      { locale: BRIDGE_KEY_LOCALE, value: character.characterKey },
      ...character.aliases.map((value) => ({ locale: BRIDGE_ALIAS_LOCALE, value })),
    ]
    for (const desired of desiredAliases) {
      const normalizedValue = normalizeCatalogName(desired.value)
      const matching = aliases.filter(
        (alias) => alias.locale === desired.locale && alias.normalizedValue === normalizedValue,
      )
      if (matching.length > 1) {
        throw new FormalBridgeError(
          'formal-import',
          'CharacterAlias',
          `${character.characterKey}:${desired.locale}:${normalizedValue}`,
          'Bridge alias identity is duplicated.',
        )
      }
      const existing = matching[0]
      if (existing) {
        if (
          relationId(existing.character, 'CharacterAlias', desired.value, 'character') !==
            document.id ||
          existing.value !== desired.value
        ) {
          throw new FormalBridgeError(
            'formal-import',
            'CharacterAlias',
            `${character.characterKey}:${desired.locale}:${normalizedValue}`,
            'Existing bridge alias conflicts with the requested Character.',
          )
        }
        input.summary.characterAliases.unchanged += 1
        continue
      }
      const created = await recordOperation(
        'formal-import',
        'CharacterAlias',
        `${character.characterKey}:${desired.locale}:${normalizedValue}`,
        () =>
          input.payload.create({
            collection: 'character-aliases',
            data: {
              aliasType: 'source_only',
              character: document.id,
              createdBy: input.actor.id,
              isPreferred: false,
              locale: desired.locale,
              normalizedValue,
              value: desired.value,
            } as never,
            overrideAccess: true,
            req: input.req,
          }),
      )
      aliases.push(created)
      input.summary.characterAliases.inserted += 1
    }
  }

  return result
}

function expectedPrototype(
  prototype: FormalBridgeFigurePrototype,
  characterId: DocumentId,
  actorId: DocumentId,
): Record<string, unknown> {
  return {
    characterId,
    data: {
      figureType: prototype.figureType,
      isGroup: prototype.isGroup,
      membershipFingerprint: prototype.membershipFingerprint,
      normalizedTitle: normalizeCatalogName(prototype.title),
      scale: prototype.scale,
      title: prototype.title,
    },
    create: {
      adultEntryFlag: false,
      authorizationStatus: 'pending',
      createdBy: actorId,
      figureType: prototype.figureType,
      inclusionStatus: 'pending',
      isGroup: prototype.isGroup,
      lockVersion: 1,
      membershipFingerprint: prototype.membershipFingerprint,
      normalizedTitle: normalizeCatalogName(prototype.title),
      projectionKey: prototype.projectionKey,
      publicationStatus: 'draft',
      scale: prototype.scale,
      title: prototype.title,
      updatedBy: actorId,
    },
  }
}

function actualPrototype(document: FigurePrototype): Record<string, unknown> {
  return {
    figureType: document.figureType,
    isGroup: document.isGroup,
    membershipFingerprint: nullableText(document.membershipFingerprint),
    normalizedTitle: document.normalizedTitle,
    scale: nullableText(document.scale),
    title: document.title,
  }
}

async function importPrototypes(input: {
  actor: User
  bundle: FormalBridgeBundle
  characters: Map<string, Character>
  payload: Payload
  req: PayloadRequest
  summary: FormalBridgeImportSummary
}): Promise<Map<string, FigurePrototype>> {
  const found = await input.payload.find({
    collection: 'figure-prototypes',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    where: {
      projectionKey: { in: input.bundle.figurePrototypes.map((entry) => entry.projectionKey) },
    },
  })
  const existingByKey = new Map(
    found.docs
      .filter((document) => document.projectionKey && !document.archivedAt)
      .map((document) => [document.projectionKey as string, document]),
  )
  if (existingByKey.size !== found.docs.filter((document) => document.projectionKey).length) {
    throw new FormalBridgeError(
      'formal-import',
      'FigurePrototype',
      '*',
      'Duplicate projectionKey detected.',
    )
  }

  const result = new Map<string, FigurePrototype>()
  for (const prototype of input.bundle.figurePrototypes) {
    const character = input.characters.get(prototype.characterKey)
    if (!character) {
      throw new FormalBridgeError(
        'formal-import',
        'FigurePrototype',
        prototype.projectionKey,
        `Unknown Character ${prototype.characterKey}.`,
      )
    }
    const expected = expectedPrototype(prototype, character.id, input.actor.id)
    let document = existingByKey.get(prototype.projectionKey)
    if (!document) {
      document = await recordOperation(
        'formal-import',
        'FigurePrototype',
        prototype.projectionKey,
        () =>
          input.payload.create({
            collection: 'figure-prototypes',
            data: expected.create as never,
            overrideAccess: true,
            req: input.req,
          }),
      )
      input.summary.figurePrototypes.inserted += 1
    } else if (equal(actualPrototype(document), expected.data)) {
      input.summary.figurePrototypes.unchanged += 1
    } else {
      document = await recordOperation(
        'formal-import',
        'FigurePrototype',
        prototype.projectionKey,
        () =>
          input.payload.update({
            collection: 'figure-prototypes',
            data: {
              ...(expected.data as object),
              lockVersion: document!.lockVersion + 1,
              updatedBy: input.actor.id,
            },
            id: document!.id,
            overrideAccess: true,
            req: input.req,
          }),
      )
      input.summary.figurePrototypes.updated += 1
    }
    result.set(prototype.projectionKey, document)
  }
  return result
}

async function importPrototypeCharacters(input: {
  actor: User
  bundle: FormalBridgeBundle
  characters: Map<string, Character>
  payload: Payload
  prototypes: Map<string, FigurePrototype>
  req: PayloadRequest
  summary: FormalBridgeImportSummary
}): Promise<void> {
  const prototypeIds = [...input.prototypes.values()].map((prototype) => prototype.id)
  const found = await input.payload.find({
    collection: 'figure-prototype-characters',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    where: { prototype: { in: prototypeIds } },
  })
  const byPrototype = new Map<DocumentId, FigurePrototypeCharacter[]>()
  for (const relation of found.docs.filter((entry) => !entry.deletedAt)) {
    const prototypeId = relationId(
      relation.prototype,
      'FigurePrototypeCharacter',
      String(relation.id),
      'prototype',
    )
    const values = byPrototype.get(prototypeId) ?? []
    values.push(relation)
    byPrototype.set(prototypeId, values)
  }

  for (const prototype of input.bundle.figurePrototypes) {
    const prototypeDocument = input.prototypes.get(prototype.projectionKey)!
    const character = input.characters.get(prototype.characterKey)!
    const relations = byPrototype.get(prototypeDocument.id) ?? []
    if (relations.length === 0) {
      await recordOperation(
        'formal-import',
        'FigurePrototypeCharacter',
        `${prototype.projectionKey}:${prototype.characterKey}`,
        () =>
          input.payload.create({
            collection: 'figure-prototype-characters',
            data: {
              character: character.id,
              createdBy: input.actor.id,
              displayOrder: 0,
              prototype: prototypeDocument.id,
              role: 'primary',
            } as never,
            overrideAccess: true,
            req: input.req,
          }),
      )
      input.summary.figurePrototypeCharacters.inserted += 1
      continue
    }
    if (
      relations.length !== 1 ||
      relationId(
        relations[0].character,
        'FigurePrototypeCharacter',
        prototype.projectionKey,
        'character',
      ) !== character.id ||
      relations[0].displayOrder !== 0 ||
      relations[0].role !== 'primary'
    ) {
      throw new FormalBridgeError(
        'formal-import',
        'FigurePrototypeCharacter',
        prototype.projectionKey,
        'Existing prototype-character relations conflict with the validated projection.',
      )
    }
    input.summary.figurePrototypeCharacters.unchanged += 1
  }
}

function actualCatalogItem(document: CatalogItem): Record<string, unknown> {
  return {
    category: nullableText(document.category),
    character: relationId(document.character, 'CatalogItem', document.catalogItemKey, 'character'),
    classification: nullableText(document.classification),
    description: nullableText(document.description),
    heightMm: document.heightMm ?? null,
    imageRefs: normalizeImageRefs(document.imageRefs),
    manufacturerText: document.manufacturerText,
    productType: nullableText(document.productType),
    prototype: relationId(document.prototype, 'CatalogItem', document.catalogItemKey, 'prototype'),
    release: nullableText(document.release),
    scale: nullableText(document.scale),
    series: nullableText(document.series),
    title: document.title,
  }
}

function expectedCatalogItem(
  item: FormalBridgeCatalogItem,
  characterId: DocumentId,
  prototypeId: DocumentId,
): Record<string, unknown> {
  return {
    category: item.category,
    character: characterId,
    classification: item.classification,
    description: item.description,
    heightMm: item.heightMm,
    imageRefs: item.imageRefs,
    manufacturerText: item.manufacturerText,
    productType: item.productType,
    prototype: prototypeId,
    release: item.release,
    scale: item.scale,
    series: item.series,
    title: item.title,
  }
}

async function importCatalogItems(input: {
  actor: User
  bundle: FormalBridgeBundle
  characters: Map<string, Character>
  payload: Payload
  prototypes: Map<string, FigurePrototype>
  req: PayloadRequest
  summary: FormalBridgeImportSummary
}): Promise<Map<string, CatalogItem>> {
  const found = await input.payload.find({
    collection: 'catalog-items',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    where: {
      catalogItemKey: { in: input.bundle.catalogItems.map((entry) => entry.catalogItemKey) },
    },
  })
  const existingByKey = new Map(found.docs.map((document) => [document.catalogItemKey, document]))
  if (existingByKey.size !== found.docs.length) {
    throw new FormalBridgeError(
      'formal-import',
      'CatalogItem',
      '*',
      'Duplicate catalogItemKey detected.',
    )
  }

  const result = new Map<string, CatalogItem>()
  for (const item of input.bundle.catalogItems) {
    const character = input.characters.get(item.characterKey)
    const prototype = input.prototypes.get(item.prototypeKey)
    if (!character || !prototype) {
      throw new FormalBridgeError(
        'formal-import',
        'CatalogItem',
        item.catalogItemKey,
        'Character or FigurePrototype relation is missing.',
      )
    }
    const desired = expectedCatalogItem(item, character.id, prototype.id)
    let document = existingByKey.get(item.catalogItemKey)
    if (!document) {
      document = await recordOperation('formal-import', 'CatalogItem', item.catalogItemKey, () =>
        input.payload.create({
          collection: 'catalog-items',
          data: {
            ...desired,
            catalogItemKey: item.catalogItemKey,
            createdBy: input.actor.id,
            lockVersion: 1,
            updatedBy: input.actor.id,
          } as never,
          overrideAccess: true,
          req: input.req,
        }),
      )
      input.summary.catalogItems.inserted += 1
    } else if (equal(actualCatalogItem(document), desired)) {
      input.summary.catalogItems.unchanged += 1
    } else {
      document = await recordOperation('formal-import', 'CatalogItem', item.catalogItemKey, () =>
        input.payload.update({
          collection: 'catalog-items',
          data: {
            ...desired,
            lockVersion: document!.lockVersion + 1,
            updatedBy: input.actor.id,
          } as never,
          id: document!.id,
          overrideAccess: true,
          req: input.req,
        }),
      )
      input.summary.catalogItems.updated += 1
    }
    result.set(item.catalogItemKey, document)
  }
  return result
}

function actualSourceRecord(document: SourceRecord): Record<string, unknown> {
  return {
    businessDigest: document.businessDigest,
    businessDigestVersion: document.businessDigestVersion,
    catalogItem: relationId(
      document.catalogItem,
      'SourceRecord',
      document.sourceRecordKey,
      'catalogItem',
    ),
    character: relationId(
      document.character,
      'SourceRecord',
      document.sourceRecordKey,
      'character',
    ),
    observedManufacturer: nullableText(document.observedManufacturer),
    observedTitle: nullableText(document.observedTitle),
    sourceFamily: document.sourceFamily,
    sourceLabel: nullableText(document.sourceLabel),
    sourceRole: nullableText(document.sourceRole),
    sourceUrl: document.sourceUrl,
  }
}

function expectedSourceRecord(
  source: FormalBridgeSourceRecord,
  characterId: DocumentId,
  catalogItemId: DocumentId,
): Record<string, unknown> {
  return {
    businessDigest: source.businessDigest,
    businessDigestVersion: source.businessDigestVersion,
    catalogItem: catalogItemId,
    character: characterId,
    observedManufacturer: source.observedManufacturer,
    observedTitle: source.observedTitle,
    sourceFamily: source.sourceFamily,
    sourceLabel: source.sourceLabel,
    sourceRole: source.sourceRole,
    sourceUrl: source.sourceUrl,
  }
}

async function importSourceRecords(input: {
  actor: User
  bundle: FormalBridgeBundle
  catalogItems: Map<string, CatalogItem>
  characters: Map<string, Character>
  payload: Payload
  req: PayloadRequest
  summary: FormalBridgeImportSummary
}): Promise<void> {
  const found = await input.payload.find({
    collection: 'source-records',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    where: {
      sourceRecordKey: { in: input.bundle.sourceRecords.map((entry) => entry.sourceRecordKey) },
    },
  })
  const existingByKey = new Map(found.docs.map((document) => [document.sourceRecordKey, document]))
  if (existingByKey.size !== found.docs.length) {
    throw new FormalBridgeError(
      'formal-import',
      'SourceRecord',
      '*',
      'Duplicate sourceRecordKey detected.',
    )
  }

  for (const source of input.bundle.sourceRecords) {
    const character = input.characters.get(source.characterKey)
    const catalogItem = input.catalogItems.get(source.catalogItemKey)
    if (!character || !catalogItem) {
      throw new FormalBridgeError(
        'formal-import',
        'SourceRecord',
        source.sourceRecordKey,
        'Character or CatalogItem relation is missing.',
      )
    }
    const desired = expectedSourceRecord(source, character.id, catalogItem.id)
    let document = existingByKey.get(source.sourceRecordKey)
    if (!document) {
      await recordOperation('formal-import', 'SourceRecord', source.sourceRecordKey, () =>
        input.payload.create({
          collection: 'source-records',
          data: {
            ...desired,
            createdBy: input.actor.id,
            lockVersion: 1,
            sourceRecordKey: source.sourceRecordKey,
            updatedBy: input.actor.id,
          } as never,
          overrideAccess: true,
          req: input.req,
        }),
      )
      input.summary.sourceRecords.inserted += 1
      continue
    }
    const actual = actualSourceRecord(document)
    const immutableFields = ['catalogItem', 'character', 'sourceFamily', 'sourceUrl'] as const
    for (const field of immutableFields) {
      if (!equal(actual[field], desired[field])) {
        throw new FormalBridgeError(
          'formal-import',
          'SourceRecord',
          source.sourceRecordKey,
          `${field} conflicts with the immutable source identity.`,
        )
      }
    }
    if (equal(actual, desired)) {
      input.summary.sourceRecords.unchanged += 1
      continue
    }
    document = await recordOperation('formal-import', 'SourceRecord', source.sourceRecordKey, () =>
      input.payload.update({
        collection: 'source-records',
        data: {
          ...desired,
          lockVersion: document!.lockVersion + 1,
          updatedBy: input.actor.id,
        } as never,
        id: document!.id,
        overrideAccess: true,
        req: input.req,
      }),
    )
    input.summary.sourceRecords.updated += 1
  }
}

function changed(summary: FormalBridgeImportSummary): boolean {
  return [
    summary.characters,
    summary.characterAliases,
    summary.figurePrototypes,
    summary.figurePrototypeCharacters,
    summary.catalogItems,
    summary.sourceRecords,
  ].some((result) => result.inserted > 0 || result.updated > 0)
}

async function writeImportSummaryLog(input: {
  actor: User
  bundle: FormalBridgeBundle
  payload: Payload
  req: PayloadRequest
  summary: FormalBridgeImportSummary
}): Promise<void> {
  const operationId = uuidFromDigest(input.bundle.contentDigest)
  const existing = await input.payload.find({
    collection: 'operation-logs',
    depth: 0,
    limit: 2,
    overrideAccess: true,
    where: { operationId: { equals: operationId } },
  })
  if (existing.totalDocs > 1) {
    throw new FormalBridgeError(
      'formal-import',
      'OperationLog',
      operationId,
      'Import summary is duplicated.',
    )
  }
  const log = existing.docs[0] as OperationLog | undefined
  if (log && log.requestDigest !== input.bundle.contentDigest) {
    throw new FormalBridgeError(
      'formal-import',
      'OperationLog',
      operationId,
      'Import summary digest conflicts with the existing operation.',
    )
  }
  if (log) {
    if (changed(input.summary)) {
      throw new FormalBridgeError(
        'formal-import',
        'OperationLog',
        operationId,
        'Bridge-owned rows changed after this content digest was already logged.',
      )
    }
    return
  }

  await recordOperation('formal-import', 'OperationLog', operationId, () =>
    input.payload.create({
      collection: 'operation-logs',
      data: {
        action: 'formalCatalogBridgeImport',
        actorType: 'system',
        actorUser: input.actor.id,
        afterSnapshot: {
          catalogItems: input.bundle.catalogItems.length,
          characters: input.bundle.characters.length,
          contentDigest: input.bundle.contentDigest,
          figurePrototypes: input.bundle.figurePrototypes.length,
          sourceRecords: input.bundle.sourceRecords.length,
        },
        dutyContext: 'catalog_maintenance',
        operationId,
        reason: 'Import the owner-approved deterministic local catalog projection.',
        requestDigest: input.bundle.contentDigest,
        resultVersion: 1,
        reversible: false,
        scopeStableId: operationId,
        scopeType: 'formalCatalogBridge',
      },
      overrideAccess: true,
      req: input.req,
    }),
  )
  input.summary.operationLogInserted = 1
}

export async function importFormalBridgeBundle(
  payload: Payload,
  bundle: FormalBridgeBundle,
): Promise<FormalBridgeImportSummary> {
  validateFormalBridgeBundle(bundle)
  const canonical = createFormalBridgeBundle(bundle)
  if (canonical.contentDigest !== bundle.contentDigest) {
    throw new FormalBridgeError(
      'formal-import-validation',
      'FormalBridgeBundle',
      'contentDigest',
      'Bundle contentDigest does not match its canonical semantic payload.',
    )
  }

  const actor = await recordOperation('formal-import', 'User', BRIDGE_ACTOR_EMAIL, () =>
    ensureBridgeActor(payload),
  )
  const req = requestFor(payload, actor)
  const summary = createSummary(bundle.contentDigest)

  return withCatalogDomainWrite(req, async () => {
    const characters = await importCharacters({ actor, bundle, payload, req, summary })
    const prototypes = await importPrototypes({ actor, bundle, characters, payload, req, summary })
    await importPrototypeCharacters({
      actor,
      bundle,
      characters,
      payload,
      prototypes,
      req,
      summary,
    })
    const catalogItems = await importCatalogItems({
      actor,
      bundle,
      characters,
      payload,
      prototypes,
      req,
      summary,
    })
    await importSourceRecords({
      actor,
      bundle,
      catalogItems,
      characters,
      payload,
      req,
      summary,
    })
    await writeImportSummaryLog({ actor, bundle, payload, req, summary })
    return summary
  })
}

export const FORMAL_BRIDGE_CHARACTER_ALIAS_LOCALES = {
  alias: BRIDGE_ALIAS_LOCALE,
  key: BRIDGE_KEY_LOCALE,
} as const
