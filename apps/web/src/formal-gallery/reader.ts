import { createHash } from 'node:crypto'

import {
  buildPrototypeGalleryReadModel,
  RECOMMENDED_GALLERY_SORT,
} from '@figure-gallery/gallery-read-model'
import type { Payload } from 'payload'

import type {
  FormalBridgeBundle,
  FormalBridgeCatalogItem,
  FormalBridgeCharacter,
  FormalBridgeFigurePrototype,
  FormalBridgeSourceRecord,
} from '../formal-bridge/export'
import { FormalBridgeError } from '../formal-bridge/export'
import { readFormalBridgeBundleFromPayload } from '../formal-bridge/readback'

export interface FormalGalleryReadOptions {
  preferences?: Record<string, unknown>
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function requireCharacter(bundle: FormalBridgeBundle, characterKey: string): FormalBridgeCharacter {
  const values = bundle.characters.filter(
    (character) => character.characterKey === characterKey || character.slug === characterKey,
  )
  if (values.length !== 1) {
    throw new FormalBridgeError(
      'formal-gallery-read',
      'Character',
      characterKey,
      `Expected exactly one formal Gallery Character; found ${values.length}.`,
    )
  }
  return values[0]
}

function sourcesForItem(
  recordsByItem: Map<string, FormalBridgeSourceRecord[]>,
  catalogItemKey: string,
) {
  return (recordsByItem.get(catalogItemKey) ?? []).map((record) => ({
    label: record.sourceLabel ?? undefined,
    role: record.sourceRole ?? undefined,
    sourceFamily: record.sourceFamily,
    url: record.sourceUrl,
  }))
}

function mapCatalogItem(
  item: FormalBridgeCatalogItem,
  recordsByItem: Map<string, FormalBridgeSourceRecord[]>,
) {
  const sources = sourcesForItem(recordsByItem, item.catalogItemKey)
  return {
    category: item.category,
    classification: item.classification,
    id: item.catalogItemKey,
    manufacturer: item.manufacturerText,
    release: item.release,
    scale: item.scale,
    source: sources[0]?.sourceFamily ?? '',
    sourceUrls: sources.map((source) => source.url),
    sources,
    title: item.title,
  }
}

function mapPrototype(
  prototype: FormalBridgeFigurePrototype,
  itemsByPrototype: Map<string, FormalBridgeCatalogItem[]>,
  recordsByItem: Map<string, FormalBridgeSourceRecord[]>,
) {
  const formalItems = [...(itemsByPrototype.get(prototype.projectionKey) ?? [])].sort(
    (left, right) => compareText(left.catalogItemKey, right.catalogItemKey),
  )
  if (formalItems.length !== prototype.catalogItemKeys.length) {
    throw new FormalBridgeError(
      'formal-gallery-read',
      'FigurePrototype',
      prototype.projectionKey,
      'CatalogItem membership differs from formal Prototype membership.',
    )
  }
  const catalogItems = formalItems.map((item) => mapCatalogItem(item, recordsByItem))
  const images = formalItems.flatMap((item) =>
    item.imageRefs.map((image) => ({
      catalogItemId: item.catalogItemKey,
      id: image.imageRefKey,
      isMain: image.isMain,
      sha256: sha256(image.url),
      sourceFamily: image.sourceFamily,
      url: image.url,
    })),
  )
  const sources = catalogItems.flatMap((item) => item.sources)
  return {
    catalogItemIds: prototype.catalogItemKeys,
    catalogItems,
    classification: `likely_${prototype.figureType}`,
    groupedCatalogItemCount: prototype.catalogItemKeys.length,
    images,
    manufacturers: [...new Set(catalogItems.map((item) => item.manufacturer))].sort(compareText),
    membershipFingerprint: prototype.membershipFingerprint,
    prototypeId: prototype.projectionKey,
    scale: prototype.scale,
    sources,
    title: prototype.title,
  }
}

export function buildFormalGalleryReadModelFromBundle(
  bundle: FormalBridgeBundle,
  characterKey: string,
  options: FormalGalleryReadOptions = {},
) {
  const character = requireCharacter(bundle, characterKey)
  const recordsByItem = new Map<string, FormalBridgeSourceRecord[]>()
  for (const record of bundle.sourceRecords.filter(
    (entry) => entry.characterKey === character.characterKey,
  )) {
    const values = recordsByItem.get(record.catalogItemKey) ?? []
    values.push(record)
    values.sort((left, right) => compareText(left.sourceRecordKey, right.sourceRecordKey))
    recordsByItem.set(record.catalogItemKey, values)
  }
  const items = bundle.catalogItems.filter((item) => item.characterKey === character.characterKey)
  const itemsByPrototype = new Map<string, FormalBridgeCatalogItem[]>()
  for (const item of items) {
    const values = itemsByPrototype.get(item.prototypeKey) ?? []
    values.push(item)
    itemsByPrototype.set(item.prototypeKey, values)
  }
  const prototypes = bundle.figurePrototypes
    .filter((prototype) => prototype.characterKey === character.characterKey)
    .map((prototype) => mapPrototype(prototype, itemsByPrototype, recordsByItem))
  return buildPrototypeGalleryReadModel({
    character: {
      aliases: character.aliases,
      characterId: character.characterKey,
      displayName: character.displayName,
      slug: character.slug,
      workNames: [],
    },
    preferences: (options.preferences ?? {}) as never,
    projection: {
      character: character.displayName,
      characterSlug: character.slug,
      projectionEligibleItemCount: items.length,
      prototypes,
      schemaVersion: 1,
      sort: RECOMMENDED_GALLERY_SORT,
      sourceCatalogItemCount: items.length,
      viewMode: 'prototype_projection',
    },
  })
}

export class FormalGalleryReader {
  readonly payload: Payload

  constructor(payload: Payload) {
    this.payload = payload
  }

  async readCharacter(characterKey: string, options: FormalGalleryReadOptions = {}) {
    const bundle = await readFormalBridgeBundleFromPayload(this.payload)
    return buildFormalGalleryReadModelFromBundle(bundle, characterKey, options)
  }
}
