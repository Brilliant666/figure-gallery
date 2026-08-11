import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  attachGalleryImageDigests,
  buildPrototypeGalleryReadModel,
  compareGalleryReadModels,
} from '@figure-gallery/gallery-read-model'
import { getPayload, type Payload } from 'payload'

import config from '../src/payload.config'
import {
  FormalBridgeError,
  readFormalBridgeBundle,
  validateFormalBridgeBundle,
} from '../src/formal-bridge/export'
import {
  importFormalBridgeBundle,
  type FormalBridgeImportSummary,
} from '../src/formal-bridge/importer'
import { FormalGalleryReader } from '../src/formal-gallery/reader'

interface CliOptions {
  inputPath: string
  outputDirectory: string
  runtimeRoot: string
}

interface CharacterInput {
  config: {
    aliases: string[]
    characterId: string
    displayName: string
    slug: string
    workNames: string[]
  }
  preferences: Record<string, unknown>
  projection: Record<string, unknown> & { prototypes: Array<Record<string, unknown>> }
}

function usage(): string {
  return [
    'Usage: npm run gallery:shadow-read -- --input <catalog-export.json> --runtime-root <personal-gallery> [options]',
    '',
    'Options:',
    '  --output <directory>  Detailed local-only results (default: repo .local/formal-gallery-shadow-read).',
    '  --help                Show this message.',
  ].join('\n')
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new FormalBridgeError('shadow-read-cli', 'option', name, `Missing value for ${name}.`)
  }
  return value
}

function parseOptions(args: string[]): CliOptions {
  if (args.includes('--help')) {
    process.stdout.write(`${usage()}\n`)
    process.exit(0)
  }
  const known = new Set(['--help', '--input', '--output', '--runtime-root'])
  for (const argument of args.filter((value) => value.startsWith('--'))) {
    if (!known.has(argument)) {
      throw new FormalBridgeError(
        'shadow-read-cli',
        'option',
        argument,
        'Unknown command-line option.',
      )
    }
  }
  const inputPath = optionValue(args, '--input')
  const runtimeRoot = optionValue(args, '--runtime-root')
  if (!inputPath || !runtimeRoot) {
    throw new FormalBridgeError(
      'shadow-read-cli',
      'option',
      !inputPath ? '--input' : '--runtime-root',
      'Both --input and --runtime-root are required.',
    )
  }
  return {
    inputPath: resolve(inputPath),
    outputDirectory: resolve(
      optionValue(args, '--output') ??
        resolve(process.cwd(), '../..', '.local/formal-gallery-shadow-read'),
    ),
    runtimeRoot: resolve(runtimeRoot),
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

async function readCharacterInput(runtimeRoot: string, slug: string): Promise<CharacterInput> {
  const directory = resolve(runtimeRoot, 'characters', slug)
  const [character, projection, preferences] = await Promise.all([
    readJson<CharacterInput['config']>(resolve(directory, 'config.json')),
    readJson<CharacterInput['projection']>(resolve(directory, 'prototype-projection.json')),
    readJson<Record<string, unknown>>(resolve(directory, 'preferences.json')),
  ])
  if (character.slug !== slug || !Array.isArray(projection.prototypes)) {
    throw new FormalBridgeError(
      'shadow-read-local',
      'Character',
      slug,
      'Local Character config or Prototype projection is invalid.',
    )
  }
  return { config: character, preferences, projection }
}

function buildLocalModel(input: CharacterInput, preferences: Record<string, unknown>) {
  return buildPrototypeGalleryReadModel({
    character: input.config,
    preferences: preferences as never,
    projection: attachGalleryImageDigests(input.projection, sha256),
  })
}

function importHasNoEntityMutations(summary: FormalBridgeImportSummary): boolean {
  return [
    summary.catalogItems,
    summary.characterAliases,
    summary.characters,
    summary.figurePrototypeCharacters,
    summary.figurePrototypes,
    summary.sourceRecords,
  ].every((entry) => entry.inserted === 0 && entry.updated === 0)
}

function preferenceCases(model: ReturnType<typeof buildLocalModel>) {
  const withTwoImages = model.products.find(
    (product: { images: unknown[] }) => product.images.length >= 2,
  )
  const first = model.products[0]
  if (!withTwoImages || !first?.images?.[0]) {
    throw new FormalBridgeError(
      'shadow-read-preferences',
      'Character',
      model.characterSlug,
      'Preference parity requires one multi-image Prototype and one image-bearing Prototype.',
    )
  }
  const alternateCover = withTwoImages.images[withTwoImages.images.length - 1]
  return [
    { name: 'none', preferences: {} },
    {
      name: 'manual-cover',
      preferences: {
        products: {
          [withTwoImages.id]: { preferredCoverImageUrl: alternateCover.url },
        },
      },
    },
    { name: 'prototype-exclusion', preferences: { excludedProductIds: [first.id] } },
    { name: 'image-exclusion', preferences: { excludedImageSha256: [first.images[0].sha256] } },
    {
      name: 'manual-note',
      preferences: { products: { [first.id]: { manualNote: 'shadow parity note' } } },
    },
  ]
}

async function runCharacterParity(
  formalReader: FormalGalleryReader,
  runtimeRoot: string,
  outputDirectory: string,
  slug: string,
) {
  const input = await readCharacterInput(runtimeRoot, slug)
  const local = buildLocalModel(input, input.preferences)
  const formal = await formalReader.readCharacter(slug, { preferences: input.preferences })
  const current = compareGalleryReadModels(local, formal)
  const cases = []
  for (const fixture of preferenceCases(local)) {
    const localFixture = buildLocalModel(input, fixture.preferences)
    const formalFixture = await formalReader.readCharacter(slug, {
      preferences: fixture.preferences,
    })
    const parity = compareGalleryReadModels(localFixture, formalFixture, {
      queries: current.querySet,
    })
    cases.push({
      mismatchCount: parity.mismatchCount,
      name: fixture.name,
      passed: parity.matched,
    })
    if (!parity.matched) current.mismatches.push(...parity.mismatches)
  }
  current.mismatchCount = current.mismatches.length
  current.matched = current.mismatchCount === 0
  const characterDirectory = resolve(outputDirectory, slug)
  await mkdir(characterDirectory, { recursive: true })
  await Promise.all([
    writeFile(
      resolve(characterDirectory, 'local-read-model.json'),
      `${JSON.stringify(local, null, 2)}\n`,
    ),
    writeFile(
      resolve(characterDirectory, 'formal-read-model.json'),
      `${JSON.stringify(formal, null, 2)}\n`,
    ),
    writeFile(
      resolve(characterDirectory, 'parity-diff.json'),
      `${JSON.stringify(current, null, 2)}\n`,
    ),
  ])
  return {
    cards: local.products.length,
    cardsWithCover: local.products.filter((product: { coverImage: unknown }) => product.coverImage)
      .length,
    catalogItems: local.summary.projectionEligibleCount,
    character: slug,
    imageRefs: local.summary.imageCount,
    manufacturerFilters: current.manufacturerSet.length,
    mismatchCount: current.mismatchCount,
    passed: current.matched,
    preferenceCases: cases,
    searchQueries: current.querySet,
    typeFilters: current.typeSet.length,
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const bundle = await readFormalBridgeBundle(options.inputPath)
  const validation = validateFormalBridgeBundle(bundle)
  let payload: Payload | undefined
  try {
    payload = await getPayload({ config })
    const freshImport = await importFormalBridgeBundle(payload, bundle)
    const repeatImport = await importFormalBridgeBundle(payload, bundle)
    if (
      freshImport.errors !== 0 ||
      freshImport.unintendedUpdates !== 0 ||
      freshImport.catalogItems.inserted !== validation.counts.catalogItems ||
      freshImport.characters.inserted !== validation.counts.characters ||
      freshImport.figurePrototypes.inserted !== validation.counts.figurePrototypes ||
      freshImport.sourceRecords.inserted !== validation.counts.sourceRecords ||
      repeatImport.errors !== 0 ||
      repeatImport.unintendedUpdates !== 0 ||
      !importHasNoEntityMutations(repeatImport)
    ) {
      throw new FormalBridgeError(
        'shadow-read-import',
        'FormalBridgeBundle',
        bundle.contentDigest,
        'Fresh or repeated Formal Bridge import violated the idempotent import contract.',
      )
    }
    const reader = new FormalGalleryReader(payload)
    const characters = []
    for (const slug of ['rem', 'cheshire']) {
      characters.push(
        await runCharacterParity(reader, options.runtimeRoot, options.outputDirectory, slug),
      )
    }
    const mismatchCount = characters.reduce(
      (total, character) => total + character.mismatchCount,
      0,
    )
    const summary = {
      characters,
      contentDigest: bundle.contentDigest,
      externalMerchandiseRequests: 0,
      freshImport,
      mismatchCount,
      repeatImport,
      status: mismatchCount === 0 ? 'pass' : 'fail',
      validation: validation.counts,
    }
    await mkdir(options.outputDirectory, { recursive: true })
    await writeFile(
      resolve(options.outputDirectory, 'summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      'utf8',
    )
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    if (mismatchCount > 0) {
      throw new FormalBridgeError(
        'shadow-read-parity',
        'GalleryReadModel',
        bundle.contentDigest,
        `Formal Gallery parity produced ${mismatchCount} mismatch(es).`,
      )
    }
  } finally {
    await payload?.destroy()
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    const failure =
      error instanceof FormalBridgeError
        ? error.toJSON()
        : {
            error: error instanceof Error ? error.message : String(error),
            phase: 'shadow-read-cli',
            recordType: 'unknown',
            stableKey: 'unknown',
          }
    process.stderr.write(`${JSON.stringify(failure)}\n`)
    process.exit(1)
  },
)
