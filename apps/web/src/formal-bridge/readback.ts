import type { Payload } from 'payload'

import type {
  CatalogItem,
  FigurePrototype,
  FigurePrototypeCharacter,
  SourceRecord,
} from '../payload-types'
import {
  createFormalBridgeBundle,
  FormalBridgeError,
  validateFormalBridgeBundle,
  type FormalBridgeBundle,
  type FormalBridgeCatalogItem,
  type FormalBridgeCharacter,
  type FormalBridgeFigurePrototype,
  type FormalBridgeImageRef,
  type FormalBridgeSourceRecord,
  type FormalBridgeSourceFamily,
} from './export'
import { FORMAL_BRIDGE_CHARACTER_ALIAS_LOCALES } from './importer'

type DocumentId = number | string

function relationId(value: unknown, type: string, key: string, field: string): DocumentId {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  throw new FormalBridgeError('formal-readback', type, key, `${field} has no relationship ID.`)
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function requireOne<T>(values: T[], type: string, key: string, relation: string): T {
  if (values.length !== 1) {
    throw new FormalBridgeError(
      'formal-readback',
      type,
      key,
      `Expected exactly one ${relation}; found ${values.length}.`,
    )
  }
  return values[0]
}

function normalizeImages(item: CatalogItem): FormalBridgeImageRef[] {
  return (item.imageRefs ?? []).map((image) => ({
    catalogItemKey: image.catalogItemKey,
    imageRefKey: image.imageRefKey,
    isMain: image.isMain,
    sourceFamily: image.sourceFamily as FormalBridgeSourceFamily,
    url: image.url,
  }))
}

async function readBridgeCharacters(payload: Payload): Promise<{
  characterKeyById: Map<DocumentId, string>
  characters: FormalBridgeCharacter[]
}> {
  const aliasResult = await payload.find({
    collection: 'character-aliases',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: {
      locale: {
        in: [
          FORMAL_BRIDGE_CHARACTER_ALIAS_LOCALES.key,
          FORMAL_BRIDGE_CHARACTER_ALIAS_LOCALES.alias,
        ],
      },
    },
  })
  const aliases = aliasResult.docs.filter((alias) => !alias.deletedAt)
  const keyAliases = aliases.filter(
    (alias) => alias.locale === FORMAL_BRIDGE_CHARACTER_ALIAS_LOCALES.key,
  )
  const characterIds = [
    ...new Set(
      keyAliases.map((alias) =>
        relationId(alias.character, 'CharacterAlias', alias.value, 'character'),
      ),
    ),
  ]
  const characterResult = await payload.find({
    collection: 'characters',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: { id: { in: characterIds } },
  })
  const characterById = new Map<DocumentId, (typeof characterResult.docs)[number]>(
    characterResult.docs
      .filter((character) => !character.deletedAt)
      .map((character) => [character.id, character]),
  )
  const characterKeyById = new Map<DocumentId, string>()
  const characters: FormalBridgeCharacter[] = []

  for (const keyAlias of keyAliases) {
    const characterId = relationId(
      keyAlias.character,
      'CharacterAlias',
      keyAlias.value,
      'character',
    )
    if (characterKeyById.has(characterId)) {
      throw new FormalBridgeError(
        'formal-readback',
        'Character',
        keyAlias.value,
        'A Character has more than one active bridge key.',
      )
    }
    const character = characterById.get(characterId)
    if (!character) {
      throw new FormalBridgeError(
        'formal-readback',
        'Character',
        keyAlias.value,
        'Bridge Character does not exist or is deleted.',
      )
    }
    const values = aliases
      .filter(
        (alias) =>
          alias.locale === FORMAL_BRIDGE_CHARACTER_ALIAS_LOCALES.alias &&
          relationId(alias.character, 'CharacterAlias', alias.value, 'character') === characterId,
      )
      .map((alias) => alias.value)
    characterKeyById.set(characterId, keyAlias.value)
    characters.push({
      aliases: values,
      characterKey: keyAlias.value,
      displayName: character.displayName,
      slug: keyAlias.value,
    })
  }

  return { characterKeyById, characters }
}

function mapCatalogItem(
  item: CatalogItem,
  characterKeyById: Map<DocumentId, string>,
  prototypeKeyById: Map<DocumentId, string>,
): FormalBridgeCatalogItem {
  const characterId = relationId(item.character, 'CatalogItem', item.catalogItemKey, 'character')
  const prototypeId = relationId(item.prototype, 'CatalogItem', item.catalogItemKey, 'prototype')
  const characterKey = characterKeyById.get(characterId)
  const prototypeKey = prototypeKeyById.get(prototypeId)
  if (!characterKey || !prototypeKey) {
    throw new FormalBridgeError(
      'formal-readback',
      'CatalogItem',
      item.catalogItemKey,
      'Character or FigurePrototype bridge identity is missing.',
    )
  }
  return {
    catalogItemKey: item.catalogItemKey,
    category: nullableText(item.category),
    characterKey,
    classification: item.classification as FormalBridgeCatalogItem['classification'],
    description: nullableText(item.description),
    heightMm: item.heightMm ?? null,
    imageRefs: normalizeImages(item),
    manufacturerText: item.manufacturerText,
    productType: nullableText(item.productType),
    prototypeKey,
    release: nullableText(item.release),
    scale: nullableText(item.scale),
    series: nullableText(item.series),
    title: item.title,
  }
}

function mapSourceRecord(
  source: SourceRecord,
  characterKeyById: Map<DocumentId, string>,
  catalogItemKeyById: Map<DocumentId, string>,
): FormalBridgeSourceRecord {
  const characterKey = characterKeyById.get(
    relationId(source.character, 'SourceRecord', source.sourceRecordKey, 'character'),
  )
  const catalogItemKey = catalogItemKeyById.get(
    relationId(source.catalogItem, 'SourceRecord', source.sourceRecordKey, 'catalogItem'),
  )
  if (!characterKey || !catalogItemKey) {
    throw new FormalBridgeError(
      'formal-readback',
      'SourceRecord',
      source.sourceRecordKey,
      'Character or CatalogItem bridge identity is missing.',
    )
  }
  if (source.observedTitle || source.observedManufacturer) {
    throw new FormalBridgeError(
      'formal-readback',
      'SourceRecord',
      source.sourceRecordKey,
      'Bridge source-specific observations were not present in the validated input.',
    )
  }
  return {
    businessDigest: source.businessDigest,
    businessDigestVersion: source.businessDigestVersion as 1,
    catalogItemKey,
    characterKey,
    observedManufacturer: null,
    observedTitle: null,
    sourceFamily: source.sourceFamily as FormalBridgeSourceFamily,
    sourceLabel: nullableText(source.sourceLabel),
    sourceRecordKey: source.sourceRecordKey,
    sourceRole: nullableText(source.sourceRole),
    sourceUrl: source.sourceUrl,
  }
}

export async function readFormalBridgeBundleFromPayload(
  payload: Payload,
): Promise<FormalBridgeBundle> {
  const { characterKeyById, characters } = await readBridgeCharacters(payload)
  const prototypeResult = await payload.find({
    collection: 'figure-prototypes',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    where: { projectionKey: { exists: true } },
  })
  const prototypeDocuments = prototypeResult.docs.filter(
    (prototype): prototype is FigurePrototype & { projectionKey: string } =>
      typeof prototype.projectionKey === 'string' && prototype.projectionKey !== '',
  )
  const prototypeKeyById = new Map(
    prototypeDocuments.map((prototype) => [prototype.id, prototype.projectionKey]),
  )
  if (prototypeKeyById.size !== prototypeDocuments.length) {
    throw new FormalBridgeError(
      'formal-readback',
      'FigurePrototype',
      '*',
      'Duplicate projectionKey detected in formal persistence.',
    )
  }

  const relationResult = await payload.find({
    collection: 'figure-prototype-characters',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    where: { prototype: { in: [...prototypeKeyById.keys()] } },
  })
  const relationsByPrototype = new Map<DocumentId, FigurePrototypeCharacter[]>()
  for (const relation of relationResult.docs.filter((entry) => !entry.deletedAt)) {
    const prototypeId = relationId(
      relation.prototype,
      'FigurePrototypeCharacter',
      String(relation.id),
      'prototype',
    )
    const values = relationsByPrototype.get(prototypeId) ?? []
    values.push(relation)
    relationsByPrototype.set(prototypeId, values)
  }

  const catalogResult = await payload.find({
    collection: 'catalog-items',
    depth: 0,
    limit: 500,
    overrideAccess: true,
  })
  const catalogDocuments = catalogResult.docs.filter((item) => !item.deletedAt)
  const catalogItemKeyById = new Map(catalogDocuments.map((item) => [item.id, item.catalogItemKey]))
  if (catalogItemKeyById.size !== catalogDocuments.length) {
    throw new FormalBridgeError(
      'formal-readback',
      'CatalogItem',
      '*',
      'Duplicate catalogItemKey detected in formal persistence.',
    )
  }
  const catalogItems = catalogDocuments.map((item) =>
    mapCatalogItem(item, characterKeyById, prototypeKeyById),
  )
  const membersByPrototype = new Map<string, string[]>()
  for (const item of catalogItems) {
    const values = membersByPrototype.get(item.prototypeKey) ?? []
    values.push(item.catalogItemKey)
    membersByPrototype.set(item.prototypeKey, values)
  }

  const figurePrototypes: FormalBridgeFigurePrototype[] = prototypeDocuments.map((prototype) => {
    const relation = requireOne(
      relationsByPrototype.get(prototype.id) ?? [],
      'FigurePrototype',
      prototype.projectionKey,
      'active Character relation',
    )
    const characterKey = characterKeyById.get(
      relationId(
        relation.character,
        'FigurePrototypeCharacter',
        prototype.projectionKey,
        'character',
      ),
    )
    if (!characterKey) {
      throw new FormalBridgeError(
        'formal-readback',
        'FigurePrototype',
        prototype.projectionKey,
        'Character bridge identity is missing.',
      )
    }
    if (!prototype.membershipFingerprint) {
      throw new FormalBridgeError(
        'formal-readback',
        'FigurePrototype',
        prototype.projectionKey,
        'membershipFingerprint is missing.',
      )
    }
    return {
      catalogItemKeys: membersByPrototype.get(prototype.projectionKey) ?? [],
      characterKey,
      figureType: prototype.figureType,
      isGroup: prototype.isGroup,
      membershipFingerprint: prototype.membershipFingerprint,
      projectionKey: prototype.projectionKey,
      scale: nullableText(prototype.scale),
      title: prototype.title,
    }
  })

  const sourceResult = await payload.find({
    collection: 'source-records',
    depth: 0,
    limit: 500,
    overrideAccess: true,
  })
  const sourceRecords = sourceResult.docs
    .filter((source) => !source.deletedAt)
    .map((source) => mapSourceRecord(source, characterKeyById, catalogItemKeyById))

  const bundle = createFormalBridgeBundle({
    catalogItems,
    characters,
    figurePrototypes,
    schemaVersion: 1,
    sourceRecords,
  })
  validateFormalBridgeBundle(bundle)
  return bundle
}
