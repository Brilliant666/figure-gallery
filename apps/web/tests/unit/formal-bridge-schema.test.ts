import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { FIGURE_TYPES } from '@figure-gallery/domain-contracts'
import type { CollectionConfig, Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { CatalogCollections } from '../../src/collections/CatalogCollections'
import { RESTRICTED_CATALOG_REFERENCES } from '../../src/db/catalog-foreign-key-policy'
import { migrations } from '../../src/migrations'

function collection(slug: string): CollectionConfig {
  const match = CatalogCollections.find((candidate) => candidate.slug === slug)
  if (!match) throw new Error(`Missing Collection ${slug}.`)
  return match
}

function field(config: CollectionConfig, name: string): Field {
  const match = config.fields.find((candidate) => 'name' in candidate && candidate.name === name)
  if (!match) throw new Error(`Missing field ${config.slug}.${name}.`)
  return match
}

describe('formal catalog bridge schema', () => {
  it('registers exactly the two bridge Collections behind the existing private write boundary', () => {
    expect(CatalogCollections.map(({ slug }) => slug)).toEqual([
      'works',
      'characters',
      'character-aliases',
      'manufacturers',
      'figure-prototypes',
      'figure-prototype-characters',
      'figure-versions',
      'catalog-items',
      'source-records',
      'operation-logs',
    ])

    for (const slug of ['catalog-items', 'source-records']) {
      const config = collection(slug)
      expect(config.access?.create?.({} as never)).toBe(false)
      expect(config.access?.update?.({} as never)).toBe(false)
      expect(config.access?.delete?.({} as never)).toBe(false)
      expect(config.graphQL).toMatchObject({ disableMutations: true })
      expect(config.hooks?.beforeOperation).toHaveLength(1)
    }
  })

  it('models membership through CatalogItem and embeds provenance without a fabricated SourceRecord ID', () => {
    const catalogItem = collection('catalog-items')
    expect(field(catalogItem, 'catalogItemKey')).toMatchObject({
      index: true,
      required: true,
      unique: true,
    })
    expect(field(catalogItem, 'character')).toMatchObject({
      relationTo: 'characters',
      required: true,
    })
    expect(field(catalogItem, 'prototype')).toMatchObject({
      relationTo: 'figure-prototypes',
      required: true,
    })
    expect(field(catalogItem, 'manufacturerText')).toMatchObject({ required: true })
    expect(field(catalogItem, 'classification')).toMatchObject({ required: true })
    expect(field(catalogItem, 'category')).toBeDefined()
    expect(field(catalogItem, 'heightMm')).toMatchObject({ min: 0, type: 'number' })
    expect(field(catalogItem, 'description')).toMatchObject({ type: 'textarea' })

    const imageRefs = field(catalogItem, 'imageRefs') as Extract<Field, { type: 'array' }>
    expect(
      imageRefs.fields.map((candidate) => ('name' in candidate ? candidate.name : null)),
    ).toEqual(['imageRefKey', 'url', 'sourceFamily', 'catalogItemKey', 'isMain'])
  })

  it('retains nullable observed source values and exact source/catalog relationships', () => {
    const sourceRecord = collection('source-records')
    expect(field(sourceRecord, 'sourceRecordKey')).toMatchObject({
      index: true,
      required: true,
      unique: true,
    })
    expect(field(sourceRecord, 'character')).toMatchObject({
      relationTo: 'characters',
      required: true,
    })
    expect(field(sourceRecord, 'catalogItem')).toMatchObject({
      relationTo: 'catalog-items',
      required: true,
    })
    expect(field(sourceRecord, 'observedTitle')).not.toHaveProperty('required', true)
    expect(field(sourceRecord, 'observedManufacturer')).not.toHaveProperty('required', true)
    expect(field(sourceRecord, 'sourceLabel')).not.toHaveProperty('required', true)
    expect(field(sourceRecord, 'sourceRole')).not.toHaveProperty('required', true)

    const digest = field(sourceRecord, 'businessDigest') as Extract<Field, { type: 'text' }>
    const validateDigest = digest.validate as ((value: unknown) => unknown) | undefined
    expect(validateDigest?.('a'.repeat(64))).toBe(true)
    expect(validateDigest?.('A'.repeat(64))).toBe(
      'businessDigest must be a lowercase SHA-256 hex digest.',
    )
  })

  it('extends FigurePrototype only with bridge identity and the validated static type', () => {
    const prototype = collection('figure-prototypes')
    expect(FIGURE_TYPES).toEqual(['scale', 'prize', 'static'])
    expect(field(prototype, 'projectionKey')).toMatchObject({
      index: true,
      required: false,
      unique: true,
    })
    expect(field(prototype, 'membershipFingerprint')).toMatchObject({
      maxLength: 64,
      minLength: 64,
      required: false,
    })
    expect(field(prototype, 'manufacturer')).not.toHaveProperty('required', true)
  })

  it('restricts all four new bridge foreign keys', () => {
    expect(RESTRICTED_CATALOG_REFERENCES).toEqual(
      expect.arrayContaining([
        ['catalog_items', 'character_id', 'characters'],
        ['catalog_items', 'prototype_id', 'figure_prototypes'],
        ['source_records', 'character_id', 'characters'],
        ['source_records', 'catalog_item_id', 'catalog_items'],
      ]),
    )
    expect(RESTRICTED_CATALOG_REFERENCES).toHaveLength(12)
  })

  it('ships one additive migration with indexes and integrity checks', () => {
    expect(migrations.map(({ name }) => name)).toHaveLength(3)
    const migrationDirectory = fileURLToPath(new URL('../../src/migrations/', import.meta.url))
    const fileName = readdirSync(migrationDirectory).find((name) =>
      name.endsWith('_formal_catalog_bridge.ts'),
    )
    expect(fileName).toBeDefined()
    const source = readFileSync(`${migrationDirectory}/${fileName}`, 'utf8')

    for (const marker of [
      'CREATE TABLE "catalog_items"',
      'CREATE TABLE "source_records"',
      'CREATE TABLE "catalog_items_image_refs"',
      'catalog_items_catalog_item_key_idx',
      'source_records_source_record_key_idx',
      'figure_prototypes_projection_key_idx',
      'figure_prototypes_projection_identity_chk',
      'source_records_business_digest_chk',
      "ADD VALUE 'static'",
    ]) {
      expect(source).toContain(marker)
    }
  })
})
