import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  FORMAL_BRIDGE_SCHEMA_VERSION,
  FormalBridgeError,
  buildFormalBridgeExport,
  buildMembershipFingerprint,
  buildSourceRecordBusinessDigest,
  buildSourceRecordKey,
  createFormalBridgeBundle,
  resolveFormalBridgeInputPaths,
  sha256,
  validateFormalBridgeBundle,
  validateFormalBridgeParity,
  type FormalBridgeSemanticBundle,
  type FormalBridgeSourceRecord,
} from '@/formal-bridge/export'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

function validSemanticBundle(): FormalBridgeSemanticBundle {
  const catalogItemKey = 'rem:item-1'
  const projectionKey = 'rem-proto-example'
  const sourceUrl = 'https://example.test/rem/item-1'
  const sourceRecordWithoutDigest: Omit<FormalBridgeSourceRecord, 'businessDigest'> = {
    businessDigestVersion: 1,
    catalogItemKey,
    characterKey: 'rem',
    observedManufacturer: null,
    observedTitle: null,
    sourceFamily: 'goodsmile',
    sourceLabel: 'Example source',
    sourceRecordKey: buildSourceRecordKey('goodsmile', sourceUrl),
    sourceRole: 'official',
    sourceUrl,
  }
  return {
    catalogItems: [
      {
        catalogItemKey,
        category: 'Figure',
        characterKey: 'rem',
        classification: 'likely_scale',
        description: null,
        heightMm: 220,
        imageRefs: [
          {
            catalogItemKey,
            imageRefKey: 'image-ref-example',
            isMain: true,
            sourceFamily: 'goodsmile',
            url: 'https://example.test/rem/item-1.jpg',
          },
        ],
        manufacturerText: 'Example Manufacturer',
        productType: 'Figure',
        prototypeKey: projectionKey,
        release: '2026/08',
        scale: '1/7',
        series: 'Example Series',
        title: 'Example Rem Figure',
      },
    ],
    characters: [
      { aliases: ['レム', 'Rem', '蕾姆'], characterKey: 'rem', displayName: '蕾姆', slug: 'rem' },
    ],
    figurePrototypes: [
      {
        catalogItemKeys: [catalogItemKey],
        characterKey: 'rem',
        figureType: 'scale',
        isGroup: false,
        membershipFingerprint: buildMembershipFingerprint([catalogItemKey]),
        projectionKey,
        scale: '1/7',
        title: 'Example Rem Figure',
      },
    ],
    schemaVersion: FORMAL_BRIDGE_SCHEMA_VERSION,
    sourceRecords: [
      {
        ...sourceRecordWithoutDigest,
        businessDigest: buildSourceRecordBusinessDigest(sourceRecordWithoutDigest),
      },
    ],
  }
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function writeJson(path: string, value: unknown): Promise<Buffer> {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  return bytes
}

async function writeSyntheticCharacter(
  root: string,
  slug: 'cheshire' | 'rem',
  sourceFamily: 'goodsmile' | 'solaris',
): Promise<string> {
  const characterDirectory = join(root, 'personal-gallery', 'characters', slug)
  const catalogItemKey = `${slug}:item-1`
  const projectionKey = `${slug}-proto-example`
  const sourceUrl = `https://example.test/${slug}/item-1`
  const imageUrl = `https://example.test/${slug}/item-1.jpg`
  const rawCatalog = {
    items: [
      {
        category: 'Figure',
        id: catalogItemKey,
        image_urls: [imageUrl],
        manufacturer: 'Example Manufacturer',
        release: '',
        scale: '1/7',
        source_urls: [sourceUrl],
        title: `Example ${slug} Figure`,
      },
    ],
  }
  const catalogPath =
    slug === 'rem'
      ? join(root, 'rem-figures.json')
      : join(root, 'character-figure-collector-final', 'cheshire', 'projection-input.json')
  const catalogBytes = await writeJson(catalogPath, rawCatalog)
  const membershipFingerprint = buildMembershipFingerprint([catalogItemKey])
  await writeJson(join(characterDirectory, 'config.json'), {
    aliases: [slug],
    displayName: slug,
    schemaVersion: 1,
    slug,
  })
  await writeJson(join(characterDirectory, 'prototype-identities.json'), {
    aliases: {},
    characterSlug: slug,
    identityNamespace: `test:${slug}`,
    prototypes: {
      [projectionKey]: {
        anchorCatalogItemId: catalogItemKey,
        catalogItemIds: [catalogItemKey],
        membershipFingerprint,
        prototypeId: projectionKey,
      },
    },
    schemaVersion: 1,
  })
  await writeJson(join(characterDirectory, 'prototype-projection.json'), {
    characterSlug: slug,
    groupingConflictCount: 0,
    imageRefCount: 1,
    inputs: {
      [slug === 'rem' ? 'figures.json' : 'projection-input.json']: sha256(catalogBytes),
    },
    projectionEligibleItemCount: 1,
    prototypeCount: 1,
    prototypes: [
      {
        catalogItemIds: [catalogItemKey],
        catalogItems: [
          {
            category: 'Figure',
            classification: 'likely_scale',
            id: catalogItemKey,
            manufacturer: 'Example Manufacturer',
            release: '',
            scale: '1/7',
            sourceUrls: [sourceUrl],
            sources: [
              {
                label: 'Example source',
                role: 'catalog source',
                sourceFamily,
                url: sourceUrl,
              },
            ],
            title: `Example ${slug} Figure`,
          },
        ],
        classification: 'likely_scale',
        images: [
          {
            catalogItemId: catalogItemKey,
            id: `${slug}-image-ref-example`,
            isMain: true,
            sourceFamily,
            url: imageUrl,
          },
        ],
        membershipFingerprint,
        prototypeId: projectionKey,
        title: `Example ${slug} Figure`,
      },
    ],
    schemaVersion: 2,
  })
  return catalogPath
}

describe('formal bridge semantic contract', () => {
  it('produces a deterministic digest and validates all references', () => {
    const semantic = validSemanticBundle()
    const first = createFormalBridgeBundle(semantic)
    const second = createFormalBridgeBundle({
      ...jsonClone(semantic),
      characters: semantic.characters.map((character) => ({
        ...character,
        aliases: [...character.aliases].reverse(),
      })),
    })

    expect(first.contentDigest).toBe(second.contentDigest)
    expect(validateFormalBridgeBundle(first)).toMatchObject({
      duplicateIds: 0,
      orphanRefs: 0,
    })
    expect(validateFormalBridgeParity(first, second)).toEqual({
      contentDigest: first.contentDigest,
      equal: true,
    })
  })

  it('rejects invalid schema and duplicate stable keys', () => {
    expect(() => validateFormalBridgeBundle({ schemaVersion: 99 })).toThrow(FormalBridgeError)

    const semantic = validSemanticBundle()
    semantic.catalogItems.push(jsonClone(semantic.catalogItems[0]))
    const duplicate = createFormalBridgeBundle(semantic)
    expect(() => validateFormalBridgeBundle(duplicate)).toThrow(/Duplicate catalogItemKey/)
  })

  it('rejects missing membership and an unknown source family', () => {
    const missingMembership = validSemanticBundle()
    missingMembership.figurePrototypes[0].catalogItemKeys = []
    missingMembership.figurePrototypes[0].membershipFingerprint = buildMembershipFingerprint([])
    expect(() => validateFormalBridgeBundle(createFormalBridgeBundle(missingMembership))).toThrow(
      /Missing FigurePrototype membership/,
    )

    const unknownSource = validSemanticBundle()
    unknownSource.catalogItems[0].imageRefs[0].sourceFamily = 'unknown' as 'goodsmile'
    expect(() => validateFormalBridgeBundle(createFormalBridgeBundle(unknownSource))).toThrow(
      /Unknown source family/,
    )
  })

  it('rejects machine-local paths and reports semantic parity drift', () => {
    const localPath = validSemanticBundle()
    localPath.characters[0].displayName = 'C:\\Users\\example\\runtime.json'
    expect(() => validateFormalBridgeBundle(createFormalBridgeBundle(localPath))).toThrow(
      /Local absolute paths/,
    )

    const expected = createFormalBridgeBundle(validSemanticBundle())
    const changed = validSemanticBundle()
    changed.catalogItems[0].title = 'Changed title'
    expect(() => validateFormalBridgeParity(expected, createFormalBridgeBundle(changed))).toThrow(
      /Formal read-back differs/,
    )
  })
})

describe('formal bridge runtime exporter', () => {
  it('builds the same semantic bundle twice from frozen synthetic runtime JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'figure-gallery-formal-bridge-'))
    temporaryDirectories.push(root)
    const remCatalogPath = await writeSyntheticCharacter(root, 'rem', 'goodsmile')
    await writeSyntheticCharacter(root, 'cheshire', 'solaris')
    const paths = resolveFormalBridgeInputPaths({ remCatalogPath, runtimeRoot: root })

    const first = await buildFormalBridgeExport(paths, { expectedBaseline: false })
    const second = await buildFormalBridgeExport(paths, { expectedBaseline: false })

    expect(first.bundle.contentDigest).toBe(second.bundle.contentDigest)
    expect(first.validation.counts).toMatchObject({
      catalogItems: 2,
      characters: 2,
      figurePrototypes: 2,
      imageRefs: 2,
      sourceRecords: 2,
    })
    expect(first.manifest.inputs).toHaveLength(8)
    expect(first.manifest.inputs.every((input) => /^[a-f0-9]{64}$/.test(input.sha256))).toBe(true)
    expect(JSON.stringify(first.bundle)).not.toContain(root)
    expect(JSON.stringify(first.manifest)).not.toContain(root)
  })
})
