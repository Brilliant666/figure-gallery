import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getPayload, type Payload } from 'payload'

import {
  buildMembershipFingerprint,
  buildSourceRecordBusinessDigest,
  buildSourceRecordKey,
  createFormalBridgeBundle,
  FormalBridgeError,
  readFormalBridgeBundle,
  validateFormalBridgeBundle,
  validateFormalBridgeParity,
  type FormalBridgeBundle,
  type FormalBridgeCatalogItem,
  type FormalBridgeSemanticBundle,
  type FormalBridgeSourceFamily,
  type FormalBridgeSourceRecord,
} from '../../src/formal-bridge/export'
import { importFormalBridgeBundle } from '../../src/formal-bridge/importer'
import { readFormalBridgeBundleFromPayload } from '../../src/formal-bridge/readback'
import config from '../../src/payload.config'

type BridgeRowCounts = {
  catalogItems: number
  characterKeyAliases: number
  figurePrototypeCharacters: number
  figurePrototypes: number
  sourceRecords: number
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sourceRecord(input: {
  catalogItemKey: string
  characterKey: string
  sourceFamily: FormalBridgeSourceFamily
  sourceLabel: string
  sourceRole: string
  sourceUrl: string
}): FormalBridgeSourceRecord {
  const withoutDigest: Omit<FormalBridgeSourceRecord, 'businessDigest'> = {
    businessDigestVersion: 1,
    catalogItemKey: input.catalogItemKey,
    characterKey: input.characterKey,
    observedManufacturer: null,
    observedTitle: null,
    sourceFamily: input.sourceFamily,
    sourceLabel: input.sourceLabel,
    sourceRecordKey: buildSourceRecordKey(input.sourceFamily, input.sourceUrl),
    sourceRole: input.sourceRole,
    sourceUrl: input.sourceUrl,
  }
  return {
    ...withoutDigest,
    businessDigest: buildSourceRecordBusinessDigest(withoutDigest),
  }
}

function catalogItem(input: {
  catalogItemKey: string
  characterKey: string
  classification: FormalBridgeCatalogItem['classification']
  imageFamilies: FormalBridgeSourceFamily[]
  manufacturerText: string
  prototypeKey: string
  scale: string | null
  title: string
}): FormalBridgeCatalogItem {
  return {
    catalogItemKey: input.catalogItemKey,
    category: 'Figure',
    characterKey: input.characterKey,
    classification: input.classification,
    description: null,
    heightMm: null,
    imageRefs: input.imageFamilies.map((sourceFamily, index) => ({
      catalogItemKey: input.catalogItemKey,
      imageRefKey: `${input.catalogItemKey}:image:${index + 1}`,
      isMain: index === 0,
      sourceFamily,
      url: `https://example.test/${input.catalogItemKey}/image-${index + 1}.png`,
    })),
    manufacturerText: input.manufacturerText,
    productType: 'Figure',
    prototypeKey: input.prototypeKey,
    release: null,
    scale: input.scale,
    series: 'Synthetic Bridge Series',
    title: input.title,
  }
}

function syntheticBundle(): FormalBridgeBundle {
  const alphaItems = ['bridge-ci:alpha:item-1', 'bridge-ci:alpha:item-2']
  const betaItems = ['bridge-ci:beta:item-1']
  const catalogItems = [
    catalogItem({
      catalogItemKey: alphaItems[0],
      characterKey: 'bridge-ci-alpha',
      classification: 'likely_scale',
      imageFamilies: ['goodsmile', 'solaris'],
      manufacturerText: 'Synthetic Maker Alpha',
      prototypeKey: 'bridge-ci-alpha-prototype',
      scale: '1/7',
      title: 'Synthetic Alpha Regular',
    }),
    catalogItem({
      catalogItemKey: alphaItems[1],
      characterKey: 'bridge-ci-alpha',
      classification: 'likely_scale',
      imageFamilies: ['japan-figure'],
      manufacturerText: 'Synthetic Maker Alpha',
      prototypeKey: 'bridge-ci-alpha-prototype',
      scale: '1/7',
      title: 'Synthetic Alpha Reissue',
    }),
    catalogItem({
      catalogItemKey: betaItems[0],
      characterKey: 'bridge-ci-beta',
      classification: 'likely_prize',
      imageFamilies: ['solaris'],
      manufacturerText: 'Synthetic Maker Beta',
      prototypeKey: 'bridge-ci-beta-prototype',
      scale: null,
      title: 'Synthetic Beta Prize',
    }),
  ]
  const sourceRecords = [
    sourceRecord({
      catalogItemKey: alphaItems[0],
      characterKey: 'bridge-ci-alpha',
      sourceFamily: 'goodsmile',
      sourceLabel: 'Synthetic official source',
      sourceRole: 'official',
      sourceUrl: 'https://example.test/alpha/item-1/official',
    }),
    sourceRecord({
      catalogItemKey: alphaItems[0],
      characterKey: 'bridge-ci-alpha',
      sourceFamily: 'solaris',
      sourceLabel: 'Synthetic catalog source',
      sourceRole: 'catalog',
      sourceUrl: 'https://example.test/alpha/item-1/catalog',
    }),
    sourceRecord({
      catalogItemKey: alphaItems[1],
      characterKey: 'bridge-ci-alpha',
      sourceFamily: 'japan-figure',
      sourceLabel: 'Synthetic distributor source',
      sourceRole: 'distributor',
      sourceUrl: 'https://example.test/alpha/item-2/distributor',
    }),
    sourceRecord({
      catalogItemKey: betaItems[0],
      characterKey: 'bridge-ci-beta',
      sourceFamily: 'solaris',
      sourceLabel: 'Synthetic catalog source',
      sourceRole: 'catalog',
      sourceUrl: 'https://example.test/beta/item-1/catalog',
    }),
  ]
  const semantic: FormalBridgeSemanticBundle = {
    catalogItems,
    characters: [
      {
        aliases: ['桥接甲', 'ブリッジ・アルファ'],
        characterKey: 'bridge-ci-alpha',
        displayName: 'Bridge CI Alpha',
        slug: 'bridge-ci-alpha',
      },
      {
        aliases: ['桥接乙', 'ブリッジ・ベータ'],
        characterKey: 'bridge-ci-beta',
        displayName: 'Bridge CI Beta',
        slug: 'bridge-ci-beta',
      },
    ],
    figurePrototypes: [
      {
        catalogItemKeys: alphaItems,
        characterKey: 'bridge-ci-alpha',
        figureType: 'scale',
        isGroup: false,
        membershipFingerprint: buildMembershipFingerprint(alphaItems),
        projectionKey: 'bridge-ci-alpha-prototype',
        scale: '1/7',
        title: 'Synthetic Alpha Prototype',
      },
      {
        catalogItemKeys: betaItems,
        characterKey: 'bridge-ci-beta',
        figureType: 'prize',
        isGroup: false,
        membershipFingerprint: buildMembershipFingerprint(betaItems),
        projectionKey: 'bridge-ci-beta-prototype',
        scale: null,
        title: 'Synthetic Beta Prototype',
      },
    ],
    schemaVersion: 1,
    sourceRecords,
  }
  return createFormalBridgeBundle(semantic)
}

async function bridgeRowCounts(
  payload: Payload,
  bundle: FormalBridgeBundle,
): Promise<BridgeRowCounts> {
  const characterKeyAliases = await payload.count({
    collection: 'character-aliases',
    overrideAccess: true,
    where: {
      and: [
        { locale: { equals: 'x-formal-bridge-key' } },
        { value: { in: bundle.characters.map((character) => character.characterKey) } },
      ],
    },
  })
  const figurePrototypes = await payload.find({
    collection: 'figure-prototypes',
    depth: 0,
    limit: 500,
    overrideAccess: true,
    where: {
      projectionKey: {
        in: bundle.figurePrototypes.map((prototype) => prototype.projectionKey),
      },
    },
  })
  const prototypeIds = figurePrototypes.docs.map((prototype) => prototype.id)
  const figurePrototypeCharacters =
    prototypeIds.length === 0
      ? { totalDocs: 0 }
      : await payload.count({
          collection: 'figure-prototype-characters',
          overrideAccess: true,
          where: { prototype: { in: prototypeIds } },
        })
  const [catalogItems, sourceRecords] = await Promise.all([
    payload.count({
      collection: 'catalog-items',
      overrideAccess: true,
      where: {
        catalogItemKey: { in: bundle.catalogItems.map((item) => item.catalogItemKey) },
      },
    }),
    payload.count({
      collection: 'source-records',
      overrideAccess: true,
      where: {
        sourceRecordKey: { in: bundle.sourceRecords.map((source) => source.sourceRecordKey) },
      },
    }),
  ])
  return {
    catalogItems: catalogItems.totalDocs,
    characterKeyAliases: characterKeyAliases.totalDocs,
    figurePrototypeCharacters: figurePrototypeCharacters.totalDocs,
    figurePrototypes: figurePrototypes.totalDocs,
    sourceRecords: sourceRecords.totalDocs,
  }
}

function allMutationCountsAreZero(
  summary: Awaited<ReturnType<typeof importFormalBridgeBundle>>,
): boolean {
  return [
    summary.characters,
    summary.characterAliases,
    summary.figurePrototypes,
    summary.figurePrototypeCharacters,
    summary.catalogItems,
    summary.sourceRecords,
  ].every((entry) => entry.inserted === 0 && entry.updated === 0)
}

function allUpdateCountsAreZero(
  summary: Awaited<ReturnType<typeof importFormalBridgeBundle>>,
): boolean {
  return [
    summary.characters,
    summary.characterAliases,
    summary.figurePrototypes,
    summary.figurePrototypeCharacters,
    summary.catalogItems,
    summary.sourceRecords,
  ].every((entry) => entry.updated === 0)
}

function assertCurrentBusinessBaseline(bundle: FormalBridgeBundle): void {
  const validation = validateFormalBridgeBundle(bundle)
  check(validation.counts.characters === 2, 'Real bridge baseline must contain 2 Characters.')
  check(
    validation.counts.catalogItems === 290,
    'Real bridge baseline must contain 290 CatalogItems.',
  )
  check(
    validation.counts.figurePrototypes === 227,
    'Real bridge baseline must contain 227 FigurePrototypes.',
  )
  check(validation.counts.imageRefs === 1_326, 'Real bridge baseline must contain 1,326 ImageRefs.')
  check(
    validation.counts.byCharacter.rem?.catalogItems === 284 &&
      validation.counts.byCharacter.cheshire?.catalogItems === 6,
    'Real bridge CatalogItem split must remain Rem 284 / Cheshire 6.',
  )
  check(
    validation.counts.byCharacter.rem?.figurePrototypes === 221 &&
      validation.counts.byCharacter.cheshire?.figurePrototypes === 6,
    'Real bridge FigurePrototype split must remain Rem 221 / Cheshire 6.',
  )
  check(
    validation.counts.byCharacter.rem?.imageRefs === 1_257 &&
      validation.counts.byCharacter.cheshire?.imageRefs === 69,
    'Real bridge ImageRef split must remain Rem 1,257 / Cheshire 69.',
  )
}

async function main(): Promise<void> {
  const inputPath = process.env.FORMAL_BRIDGE_INTEGRATION_INPUT
  const requireCurrentBaseline = process.env.FORMAL_BRIDGE_REQUIRE_CURRENT_BASELINE === 'true'
  check(
    !requireCurrentBaseline || inputPath,
    'FORMAL_BRIDGE_REQUIRE_CURRENT_BASELINE=true requires FORMAL_BRIDGE_INTEGRATION_INPUT.',
  )
  const bundle = inputPath ? await readFormalBridgeBundle(inputPath) : syntheticBundle()
  const inputValidation = validateFormalBridgeBundle(bundle)
  if (requireCurrentBaseline) assertCurrentBusinessBaseline(bundle)

  const payload = await getPayload({ config })
  try {
    const beforeInvalidImport = await bridgeRowCounts(payload, bundle)
    check(
      Object.values(beforeInvalidImport).every((count) => count === 0),
      `Bridge integration requires fresh bridge-owned identities; found ${JSON.stringify(beforeInvalidImport)}.`,
    )

    const invalid = structuredClone(bundle)
    invalid.catalogItems.push(structuredClone(invalid.catalogItems[0]))
    let invalidRejected = false
    try {
      await importFormalBridgeBundle(payload, invalid)
    } catch (error) {
      if (!(error instanceof FormalBridgeError)) throw error
      invalidRejected = true
    }
    check(invalidRejected, 'Invalid bridge input must be rejected before persistence.')
    const afterInvalidImport = await bridgeRowCounts(payload, bundle)
    check(
      JSON.stringify(afterInvalidImport) === JSON.stringify(beforeInvalidImport),
      'Rejected bridge input must not persist bridge-owned rows.',
    )

    const freshImport = await importFormalBridgeBundle(payload, bundle)
    check(freshImport.errors === 0, 'Fresh import must report zero errors.')
    check(freshImport.unintendedUpdates === 0, 'Fresh import must report zero unintended updates.')
    check(allUpdateCountsAreZero(freshImport), 'Fresh import must update zero pre-existing rows.')
    check(
      freshImport.characters.inserted === bundle.characters.length,
      'Fresh import must insert every bridge Character.',
    )
    const expectedCharacterAliases = bundle.characters.reduce(
      (count, character) => count + character.aliases.length + 1,
      0,
    )
    check(
      freshImport.characterAliases.inserted === expectedCharacterAliases,
      'Fresh import must insert every bridge key and source alias.',
    )
    check(
      freshImport.figurePrototypes.inserted === bundle.figurePrototypes.length,
      'Fresh import must insert every FigurePrototype.',
    )
    check(
      freshImport.figurePrototypeCharacters.inserted === bundle.figurePrototypes.length,
      'Fresh import must insert one Character relation per FigurePrototype.',
    )
    check(
      freshImport.catalogItems.inserted === bundle.catalogItems.length,
      'Fresh import must insert every CatalogItem.',
    )
    check(
      freshImport.sourceRecords.inserted === bundle.sourceRecords.length,
      'Fresh import must insert every exported SourceRecord without assuming a fixed total.',
    )
    check(
      freshImport.operationLogInserted === 1,
      'Fresh import must append one summary OperationLog.',
    )

    const repeatImport = await importFormalBridgeBundle(payload, bundle)
    check(allMutationCountsAreZero(repeatImport), 'Repeat import must insert and update zero rows.')
    check(repeatImport.errors === 0, 'Repeat import must report zero errors.')
    check(
      repeatImport.unintendedUpdates === 0,
      'Repeat import must report zero unintended updates.',
    )
    check(
      repeatImport.operationLogInserted === 0,
      'Repeat import must not duplicate its summary log.',
    )
    check(
      repeatImport.characters.unchanged === bundle.characters.length &&
        repeatImport.characterAliases.unchanged === expectedCharacterAliases &&
        repeatImport.figurePrototypes.unchanged === bundle.figurePrototypes.length &&
        repeatImport.figurePrototypeCharacters.unchanged === bundle.figurePrototypes.length &&
        repeatImport.catalogItems.unchanged === bundle.catalogItems.length &&
        repeatImport.sourceRecords.unchanged === bundle.sourceRecords.length,
      'Repeat import must recognize every stable bridge identity as unchanged.',
    )

    const readback = await readFormalBridgeBundleFromPayload(payload)
    const readbackValidation = validateFormalBridgeBundle(readback)
    const parity = validateFormalBridgeParity(bundle, readback)
    const persistedRows = await bridgeRowCounts(payload, bundle)
    check(
      persistedRows.characterKeyAliases === bundle.characters.length,
      'Character key aliases must be unique.',
    )
    check(
      persistedRows.figurePrototypes === bundle.figurePrototypes.length &&
        persistedRows.figurePrototypeCharacters === bundle.figurePrototypes.length,
      'Every persisted FigurePrototype must retain exactly one bridge Character relation.',
    )
    check(
      persistedRows.catalogItems === bundle.catalogItems.length,
      'CatalogItem identities must be unique.',
    )
    check(
      persistedRows.sourceRecords === bundle.sourceRecords.length,
      'SourceRecord identities must be unique and complete.',
    )

    const output = process.env.FORMAL_BRIDGE_INTEGRATION_OUTPUT
    const result = {
      database: 'PostgreSQL',
      dataset: inputPath
        ? requireCurrentBaseline
          ? 'current-business-baseline'
          : 'external'
        : 'synthetic',
      freshImport,
      freshBridgeOwnedIdentities: true,
      hpoiRequests: 0,
      input: inputValidation,
      invalidInputRejectedWithoutWrites: true,
      networkRequests: 0,
      parity,
      payloadBoundary: 'Local API',
      persistedRows,
      readback: readbackValidation,
      repeatImport,
      schemaVersion: 1,
      status: 'pass',
    }
    if (output) {
      await mkdir(path.dirname(output), { recursive: true })
      await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    }
    process.stdout.write(
      `Formal bridge PostgreSQL integration passed (${result.dataset}, ${bundle.catalogItems.length} CatalogItems, ${bundle.figurePrototypes.length} FigurePrototypes).\n`,
    )
  } finally {
    await payload.destroy()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const failure =
      error instanceof FormalBridgeError
        ? error.toJSON()
        : { error: error instanceof Error ? error.message : String(error) }
    process.stderr.write(`${JSON.stringify(failure)}\n`)
    process.exit(1)
  })
