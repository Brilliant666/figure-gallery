import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const FORMAL_BRIDGE_SCHEMA_VERSION = 1 as const
export const FORMAL_BRIDGE_SOURCE_FAMILIES = ['goodsmile', 'japan-figure', 'solaris'] as const

export type FormalBridgeSourceFamily = (typeof FORMAL_BRIDGE_SOURCE_FAMILIES)[number]
export type FormalBridgeProvenanceCounts = Record<FormalBridgeSourceFamily | 'unknown', number>
export type FormalBridgeFigureType = 'prize' | 'scale' | 'static'
export type FormalBridgeClassification = 'likely_prize' | 'likely_scale' | 'likely_static'

export interface FormalBridgeCharacter {
  aliases: string[]
  characterKey: string
  displayName: string
  slug: string
}

export interface FormalBridgeImageRef {
  catalogItemKey: string
  imageRefKey: string
  isMain: boolean
  sourceFamily: FormalBridgeSourceFamily
  url: string
}

export interface FormalBridgeCatalogItem {
  catalogItemKey: string
  category: string | null
  characterKey: string
  classification: FormalBridgeClassification
  description: string | null
  heightMm: number | null
  imageRefs: FormalBridgeImageRef[]
  manufacturerText: string
  productType: string | null
  prototypeKey: string
  release: string | null
  scale: string | null
  series: string | null
  title: string
}

export interface FormalBridgeSourceRecord {
  businessDigest: string
  businessDigestVersion: 1
  catalogItemKey: string
  characterKey: string
  observedManufacturer: null
  observedTitle: null
  sourceFamily: FormalBridgeSourceFamily
  sourceLabel: string | null
  sourceRecordKey: string
  sourceRole: string | null
  sourceUrl: string
}

export interface FormalBridgeFigurePrototype {
  catalogItemKeys: string[]
  characterKey: string
  figureType: FormalBridgeFigureType
  isGroup: boolean
  membershipFingerprint: string
  projectionKey: string
  scale: string | null
  title: string
}

export interface FormalBridgeSemanticBundle {
  catalogItems: FormalBridgeCatalogItem[]
  characters: FormalBridgeCharacter[]
  figurePrototypes: FormalBridgeFigurePrototype[]
  schemaVersion: typeof FORMAL_BRIDGE_SCHEMA_VERSION
  sourceRecords: FormalBridgeSourceRecord[]
}

export interface FormalBridgeBundle extends FormalBridgeSemanticBundle {
  contentDigest: string
}

export interface FormalBridgeInputManifestEntry {
  byteLength: number
  label: string
  sha256: string
}

export interface FormalBridgeCountSummary {
  byCharacter: Record<
    string,
    {
      catalogItems: number
      figurePrototypes: number
      imageRefs: number
      sourceRecords: number
    }
  >
  catalogItems: number
  characters: number
  crossSourceCatalogItems: number
  figurePrototypes: number
  imageProvenance: FormalBridgeProvenanceCounts
  imageRefs: number
  sourceProvenance: FormalBridgeProvenanceCounts
  sourceRecords: number
}

export interface FormalBridgeManifest {
  contentDigest: string
  counts: FormalBridgeCountSummary
  inputs: FormalBridgeInputManifestEntry[]
  schemaVersion: typeof FORMAL_BRIDGE_SCHEMA_VERSION
}

export interface FormalBridgeCharacterInputPaths {
  catalog: string
  config: string
  identityRegistry: string
  projection: string
}

export interface FormalBridgeInputPaths {
  cheshire: FormalBridgeCharacterInputPaths
  rem: FormalBridgeCharacterInputPaths
}

export interface ResolveFormalBridgeInputPathsOptions {
  cheshireCatalogPath?: string
  remCatalogPath: string
  runtimeRoot: string
}

export interface BuildFormalBridgeExportOptions {
  expectedBaseline?: FormalBridgeExpectedBaseline | false
}

export interface FormalBridgeExpectedBaseline {
  byCharacter: Record<
    string,
    {
      catalogItems: number
      figurePrototypes: number
      imageRefs: number
      rawCatalogItems: number
      sourceRecords: number
    }
  >
  catalogItems: number
  characters: number
  figurePrototypes: number
  imageProvenance: FormalBridgeProvenanceCounts
  imageRefs: number
  sourceProvenance: FormalBridgeProvenanceCounts
  sourceRecords: number
}

export interface FormalBridgeExportResult {
  bundle: FormalBridgeBundle
  manifest: FormalBridgeManifest
  validation: FormalBridgeValidationResult
}

export interface FormalBridgeValidationResult {
  counts: FormalBridgeCountSummary
  duplicateIds: number
  orphanRefs: number
}

export interface FormalBridgeParityResult {
  contentDigest: string
  equal: true
}

export const CURRENT_FORMAL_BRIDGE_BASELINE: FormalBridgeExpectedBaseline = {
  byCharacter: {
    cheshire: {
      catalogItems: 6,
      figurePrototypes: 6,
      imageRefs: 69,
      rawCatalogItems: 6,
      sourceRecords: 10,
    },
    rem: {
      catalogItems: 284,
      figurePrototypes: 221,
      imageRefs: 1_257,
      rawCatalogItems: 285,
      sourceRecords: 338,
    },
  },
  catalogItems: 290,
  characters: 2,
  figurePrototypes: 227,
  imageProvenance: {
    goodsmile: 285,
    'japan-figure': 21,
    solaris: 1_020,
    unknown: 0,
  },
  imageRefs: 1_326,
  sourceProvenance: {
    goodsmile: 35,
    'japan-figure': 21,
    solaris: 292,
    unknown: 0,
  },
  sourceRecords: 348,
}

export class FormalBridgeError extends Error {
  readonly phase: string
  readonly recordType: string
  readonly stableKey: string

  constructor(phase: string, recordType: string, stableKey: string, message: string) {
    super(message)
    this.name = 'FormalBridgeError'
    this.phase = phase
    this.recordType = recordType
    this.stableKey = stableKey
  }

  toJSON(): { error: string; phase: string; recordType: string; stableKey: string } {
    return {
      error: this.message,
      phase: this.phase,
      recordType: this.recordType,
      stableKey: this.stableKey,
    }
  }
}

type JsonRecord = Record<string, unknown>

interface LoadedJson {
  data: unknown
  manifestEntry: FormalBridgeInputManifestEntry
}

interface CharacterBuildInputs {
  catalog: LoadedJson
  config: LoadedJson
  identityRegistry: LoadedJson
  projection: LoadedJson
}

interface CharacterBuildResult {
  catalogItems: FormalBridgeCatalogItem[]
  character: FormalBridgeCharacter
  figurePrototypes: FormalBridgeFigurePrototype[]
  rawCatalogItemCount: number
  sourceRecords: FormalBridgeSourceRecord[]
}

function fail(phase: string, recordType: string, stableKey: string, message: string): never {
  throw new FormalBridgeError(phase, recordType, stableKey, message)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(
  value: unknown,
  phase: string,
  recordType: string,
  stableKey: string,
): JsonRecord {
  if (!isRecord(value)) {
    fail(phase, recordType, stableKey, 'Expected an object.')
  }
  return value
}

function requireArray(
  value: unknown,
  phase: string,
  recordType: string,
  stableKey: string,
): unknown[] {
  if (!Array.isArray(value)) {
    fail(phase, recordType, stableKey, 'Expected an array.')
  }
  return value
}

function requireString(
  value: unknown,
  phase: string,
  recordType: string,
  stableKey: string,
  field: string,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(phase, recordType, stableKey, `${field} must be a non-empty string.`)
  }
  return value.trim()
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function requireBoolean(
  value: unknown,
  phase: string,
  recordType: string,
  stableKey: string,
  field: string,
): boolean {
  if (typeof value !== 'boolean') {
    fail(phase, recordType, stableKey, `${field} must be a boolean.`)
  }
  return value
}

function requireInteger(
  value: unknown,
  phase: string,
  recordType: string,
  stableKey: string,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(phase, recordType, stableKey, `${field} must be a non-negative integer.`)
  }
  return value
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareStrings)
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson)
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, child]) => [key, canonicalizeJson(child)]),
    )
  }
  return value
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

export function buildMembershipFingerprint(catalogItemKeys: string[]): string {
  return sha256(JSON.stringify(uniqueSorted(catalogItemKeys)))
}

export function buildSourceRecordKey(
  sourceFamily: FormalBridgeSourceFamily,
  sourceUrl: string,
): string {
  return `${sourceFamily}:url:${sha256(sourceUrl.trim())}`
}

export function buildSourceRecordBusinessDigest(
  record: Omit<FormalBridgeSourceRecord, 'businessDigest'>,
): string {
  return sha256(canonicalStringify(record))
}

function semanticFromBundle(bundle: FormalBridgeBundle): FormalBridgeSemanticBundle {
  return {
    catalogItems: bundle.catalogItems,
    characters: bundle.characters,
    figurePrototypes: bundle.figurePrototypes,
    schemaVersion: bundle.schemaVersion,
    sourceRecords: bundle.sourceRecords,
  }
}

export function canonicalizeFormalBridgeSemanticBundle(
  semantic: FormalBridgeSemanticBundle,
): FormalBridgeSemanticBundle {
  return {
    catalogItems: semantic.catalogItems
      .map((item) => ({
        ...item,
        imageRefs: [...item.imageRefs].sort((left, right) =>
          compareStrings(left.imageRefKey, right.imageRefKey),
        ),
      }))
      .sort((left, right) => compareStrings(left.catalogItemKey, right.catalogItemKey)),
    characters: semantic.characters
      .map((character) => ({ ...character, aliases: uniqueSorted(character.aliases) }))
      .sort((left, right) => compareStrings(left.characterKey, right.characterKey)),
    figurePrototypes: semantic.figurePrototypes
      .map((prototype) => ({
        ...prototype,
        catalogItemKeys: uniqueSorted(prototype.catalogItemKeys),
      }))
      .sort((left, right) => compareStrings(left.projectionKey, right.projectionKey)),
    schemaVersion: FORMAL_BRIDGE_SCHEMA_VERSION,
    sourceRecords: [...semantic.sourceRecords].sort((left, right) =>
      compareStrings(left.sourceRecordKey, right.sourceRecordKey),
    ),
  }
}

export function createFormalBridgeBundle(semantic: FormalBridgeSemanticBundle): FormalBridgeBundle {
  const canonical = canonicalizeFormalBridgeSemanticBundle(semantic)
  const contentDigest = sha256(canonicalStringify(canonical))
  return { ...canonical, contentDigest }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function requireSourceFamily(
  value: unknown,
  phase: string,
  recordType: string,
  stableKey: string,
): FormalBridgeSourceFamily {
  if (
    typeof value !== 'string' ||
    !FORMAL_BRIDGE_SOURCE_FAMILIES.includes(value as FormalBridgeSourceFamily)
  ) {
    fail(phase, recordType, stableKey, `Unknown source family: ${String(value)}.`)
  }
  return value as FormalBridgeSourceFamily
}

function requireClassification(
  value: unknown,
  phase: string,
  recordType: string,
  stableKey: string,
): FormalBridgeClassification {
  if (!['likely_prize', 'likely_scale', 'likely_static'].includes(String(value))) {
    fail(phase, recordType, stableKey, `Unknown classification: ${String(value)}.`)
  }
  return value as FormalBridgeClassification
}

function requireFigureType(
  value: unknown,
  phase: string,
  recordType: string,
  stableKey: string,
): FormalBridgeFigureType {
  if (!['prize', 'scale', 'static'].includes(String(value))) {
    fail(phase, recordType, stableKey, `Unknown figure type: ${String(value)}.`)
  }
  return value as FormalBridgeFigureType
}

function assertHttpUrl(
  value: string,
  phase: string,
  recordType: string,
  stableKey: string,
  field: string,
): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    fail(phase, recordType, stableKey, `${field} must be an absolute HTTP(S) URL.`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(phase, recordType, stableKey, `${field} must use HTTP(S).`)
  }
}

function assertUnique(values: string[], phase: string, recordType: string, field: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      fail(phase, recordType, value, `Duplicate ${field}.`)
    }
    seen.add(value)
  }
}

function assertNoMachineNoise(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    if (/^[a-zA-Z]:[\\/]/.test(value) || /^\/(?:Users|home|tmp)\//.test(value)) {
      fail('export_validation', 'bundle', path, 'Local absolute paths are not exportable.')
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoMachineNoise(child, `${path}[${index}]`))
    return
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertNoMachineNoise(child, `${path}.${key}`)
    }
  }
}

function requireNullableStringField(
  record: JsonRecord,
  field: string,
  phase: string,
  recordType: string,
  stableKey: string,
): string | null {
  const value = record[field]
  if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
    fail(phase, recordType, stableKey, `${field} must be null or a non-empty string.`)
  }
  return value === null ? null : (value as string)
}

function parseBundle(candidate: unknown): FormalBridgeBundle {
  const phase = 'export_validation'
  const root = requireRecord(candidate, phase, 'bundle', 'catalog-export')
  if (root.schemaVersion !== FORMAL_BRIDGE_SCHEMA_VERSION) {
    fail(phase, 'bundle', 'catalog-export', 'Unsupported formal bridge schema version.')
  }
  if (!isSha256(root.contentDigest)) {
    fail(phase, 'bundle', 'catalog-export', 'contentDigest must be a lowercase SHA-256 digest.')
  }

  const characters = requireArray(root.characters, phase, 'character', 'characters').map(
    (value, index): FormalBridgeCharacter => {
      const record = requireRecord(value, phase, 'character', `characters[${index}]`)
      const characterKey = requireString(
        record.characterKey,
        phase,
        'character',
        `characters[${index}]`,
        'characterKey',
      )
      const aliases = requireArray(record.aliases, phase, 'character', characterKey).map(
        (alias, aliasIndex) =>
          requireString(alias, phase, 'character', characterKey, `aliases[${aliasIndex}]`),
      )
      assertUnique(aliases, phase, 'character', 'alias')
      return {
        aliases,
        characterKey,
        displayName: requireString(
          record.displayName,
          phase,
          'character',
          characterKey,
          'displayName',
        ),
        slug: requireString(record.slug, phase, 'character', characterKey, 'slug'),
      }
    },
  )

  const sourceRecords = requireArray(
    root.sourceRecords,
    phase,
    'sourceRecord',
    'sourceRecords',
  ).map((value, index): FormalBridgeSourceRecord => {
    const record = requireRecord(value, phase, 'sourceRecord', `sourceRecords[${index}]`)
    const sourceRecordKey = requireString(
      record.sourceRecordKey,
      phase,
      'sourceRecord',
      `sourceRecords[${index}]`,
      'sourceRecordKey',
    )
    const sourceFamily = requireSourceFamily(
      record.sourceFamily,
      phase,
      'sourceRecord',
      sourceRecordKey,
    )
    const sourceUrl = requireString(
      record.sourceUrl,
      phase,
      'sourceRecord',
      sourceRecordKey,
      'sourceUrl',
    )
    assertHttpUrl(sourceUrl, phase, 'sourceRecord', sourceRecordKey, 'sourceUrl')
    if (record.businessDigestVersion !== 1) {
      fail(phase, 'sourceRecord', sourceRecordKey, 'businessDigestVersion must be 1.')
    }
    if (!isSha256(record.businessDigest)) {
      fail(phase, 'sourceRecord', sourceRecordKey, 'businessDigest must be a SHA-256 digest.')
    }
    if (record.observedTitle !== null || record.observedManufacturer !== null) {
      fail(
        phase,
        'sourceRecord',
        sourceRecordKey,
        'Observed source fields must stay null when the merged runtime has no source-specific value.',
      )
    }
    return {
      businessDigest: record.businessDigest,
      businessDigestVersion: 1,
      catalogItemKey: requireString(
        record.catalogItemKey,
        phase,
        'sourceRecord',
        sourceRecordKey,
        'catalogItemKey',
      ),
      characterKey: requireString(
        record.characterKey,
        phase,
        'sourceRecord',
        sourceRecordKey,
        'characterKey',
      ),
      observedManufacturer: null,
      observedTitle: null,
      sourceFamily,
      sourceLabel: requireNullableStringField(
        record,
        'sourceLabel',
        phase,
        'sourceRecord',
        sourceRecordKey,
      ),
      sourceRecordKey,
      sourceRole: requireNullableStringField(
        record,
        'sourceRole',
        phase,
        'sourceRecord',
        sourceRecordKey,
      ),
      sourceUrl,
    }
  })

  const catalogItems = requireArray(root.catalogItems, phase, 'catalogItem', 'catalogItems').map(
    (value, index): FormalBridgeCatalogItem => {
      const record = requireRecord(value, phase, 'catalogItem', `catalogItems[${index}]`)
      const catalogItemKey = requireString(
        record.catalogItemKey,
        phase,
        'catalogItem',
        `catalogItems[${index}]`,
        'catalogItemKey',
      )
      const heightMm = record.heightMm
      if (
        heightMm !== null &&
        (typeof heightMm !== 'number' || !Number.isFinite(heightMm) || heightMm <= 0)
      ) {
        fail(phase, 'catalogItem', catalogItemKey, 'heightMm must be null or a positive number.')
      }
      const imageRefs = requireArray(record.imageRefs, phase, 'imageRef', catalogItemKey).map(
        (imageValue, imageIndex): FormalBridgeImageRef => {
          const image = requireRecord(
            imageValue,
            phase,
            'imageRef',
            `${catalogItemKey}[${imageIndex}]`,
          )
          const imageRefKey = requireString(
            image.imageRefKey,
            phase,
            'imageRef',
            `${catalogItemKey}[${imageIndex}]`,
            'imageRefKey',
          )
          const url = requireString(image.url, phase, 'imageRef', imageRefKey, 'url')
          assertHttpUrl(url, phase, 'imageRef', imageRefKey, 'url')
          return {
            catalogItemKey: requireString(
              image.catalogItemKey,
              phase,
              'imageRef',
              imageRefKey,
              'catalogItemKey',
            ),
            imageRefKey,
            isMain: requireBoolean(image.isMain, phase, 'imageRef', imageRefKey, 'isMain'),
            sourceFamily: requireSourceFamily(image.sourceFamily, phase, 'imageRef', imageRefKey),
            url,
          }
        },
      )
      return {
        catalogItemKey,
        category: requireNullableStringField(
          record,
          'category',
          phase,
          'catalogItem',
          catalogItemKey,
        ),
        characterKey: requireString(
          record.characterKey,
          phase,
          'catalogItem',
          catalogItemKey,
          'characterKey',
        ),
        classification: requireClassification(
          record.classification,
          phase,
          'catalogItem',
          catalogItemKey,
        ),
        description: requireNullableStringField(
          record,
          'description',
          phase,
          'catalogItem',
          catalogItemKey,
        ),
        heightMm: heightMm as number | null,
        imageRefs,
        manufacturerText: requireString(
          record.manufacturerText,
          phase,
          'catalogItem',
          catalogItemKey,
          'manufacturerText',
        ),
        productType: requireNullableStringField(
          record,
          'productType',
          phase,
          'catalogItem',
          catalogItemKey,
        ),
        prototypeKey: requireString(
          record.prototypeKey,
          phase,
          'catalogItem',
          catalogItemKey,
          'prototypeKey',
        ),
        release: requireNullableStringField(
          record,
          'release',
          phase,
          'catalogItem',
          catalogItemKey,
        ),
        scale: requireNullableStringField(record, 'scale', phase, 'catalogItem', catalogItemKey),
        series: requireNullableStringField(record, 'series', phase, 'catalogItem', catalogItemKey),
        title: requireString(record.title, phase, 'catalogItem', catalogItemKey, 'title'),
      }
    },
  )

  const figurePrototypes = requireArray(
    root.figurePrototypes,
    phase,
    'figurePrototype',
    'figurePrototypes',
  ).map((value, index): FormalBridgeFigurePrototype => {
    const record = requireRecord(value, phase, 'figurePrototype', `figurePrototypes[${index}]`)
    const projectionKey = requireString(
      record.projectionKey,
      phase,
      'figurePrototype',
      `figurePrototypes[${index}]`,
      'projectionKey',
    )
    if (!isSha256(record.membershipFingerprint)) {
      fail(
        phase,
        'figurePrototype',
        projectionKey,
        'membershipFingerprint must be a SHA-256 digest.',
      )
    }
    const catalogItemKeys = requireArray(
      record.catalogItemKeys,
      phase,
      'figurePrototype',
      projectionKey,
    ).map((itemKey, itemIndex) =>
      requireString(
        itemKey,
        phase,
        'figurePrototype',
        projectionKey,
        `catalogItemKeys[${itemIndex}]`,
      ),
    )
    assertUnique(catalogItemKeys, phase, 'figurePrototype', 'catalogItemKey membership')
    return {
      catalogItemKeys,
      characterKey: requireString(
        record.characterKey,
        phase,
        'figurePrototype',
        projectionKey,
        'characterKey',
      ),
      figureType: requireFigureType(record.figureType, phase, 'figurePrototype', projectionKey),
      isGroup: requireBoolean(record.isGroup, phase, 'figurePrototype', projectionKey, 'isGroup'),
      membershipFingerprint: record.membershipFingerprint,
      projectionKey,
      scale: requireNullableStringField(record, 'scale', phase, 'figurePrototype', projectionKey),
      title: requireString(record.title, phase, 'figurePrototype', projectionKey, 'title'),
    }
  })

  return {
    catalogItems,
    characters,
    contentDigest: root.contentDigest,
    figurePrototypes,
    schemaVersion: FORMAL_BRIDGE_SCHEMA_VERSION,
    sourceRecords,
  }
}

function emptySourceCounts(): FormalBridgeProvenanceCounts {
  return { goodsmile: 0, 'japan-figure': 0, solaris: 0, unknown: 0 }
}

function countBundle(bundle: FormalBridgeBundle): FormalBridgeCountSummary {
  const byCharacter: FormalBridgeCountSummary['byCharacter'] = {}
  for (const character of bundle.characters) {
    byCharacter[character.characterKey] = {
      catalogItems: 0,
      figurePrototypes: 0,
      imageRefs: 0,
      sourceRecords: 0,
    }
  }
  const imageProvenance = emptySourceCounts()
  const sourceProvenance = emptySourceCounts()
  for (const item of bundle.catalogItems) {
    byCharacter[item.characterKey].catalogItems += 1
    byCharacter[item.characterKey].imageRefs += item.imageRefs.length
    for (const image of item.imageRefs) imageProvenance[image.sourceFamily] += 1
  }
  for (const prototype of bundle.figurePrototypes) {
    byCharacter[prototype.characterKey].figurePrototypes += 1
  }
  for (const sourceRecord of bundle.sourceRecords) {
    byCharacter[sourceRecord.characterKey].sourceRecords += 1
    sourceProvenance[sourceRecord.sourceFamily] += 1
  }
  const sourceFamiliesByItem = new Map<string, Set<FormalBridgeSourceFamily>>()
  for (const sourceRecord of bundle.sourceRecords) {
    const families = sourceFamiliesByItem.get(sourceRecord.catalogItemKey) ?? new Set()
    families.add(sourceRecord.sourceFamily)
    sourceFamiliesByItem.set(sourceRecord.catalogItemKey, families)
  }
  return {
    byCharacter,
    catalogItems: bundle.catalogItems.length,
    characters: bundle.characters.length,
    crossSourceCatalogItems: [...sourceFamiliesByItem.values()].filter(
      (families) => families.size > 1,
    ).length,
    figurePrototypes: bundle.figurePrototypes.length,
    imageProvenance,
    imageRefs: bundle.catalogItems.reduce((sum, item) => sum + item.imageRefs.length, 0),
    sourceProvenance,
    sourceRecords: bundle.sourceRecords.length,
  }
}

export function validateFormalBridgeBundle(candidate: unknown): FormalBridgeValidationResult {
  const bundle = parseBundle(candidate)
  assertNoMachineNoise(semanticFromBundle(bundle))

  const characterKeys = bundle.characters.map((character) => character.characterKey)
  const characterSlugs = bundle.characters.map((character) => character.slug)
  const catalogItemKeys = bundle.catalogItems.map((item) => item.catalogItemKey)
  const projectionKeys = bundle.figurePrototypes.map((prototype) => prototype.projectionKey)
  const sourceRecordKeys = bundle.sourceRecords.map((record) => record.sourceRecordKey)
  const imageRefKeys = bundle.catalogItems.flatMap((item) =>
    item.imageRefs.map((image) => image.imageRefKey),
  )
  assertUnique(characterKeys, 'export_validation', 'character', 'characterKey')
  assertUnique(characterSlugs, 'export_validation', 'character', 'slug')
  assertUnique(catalogItemKeys, 'export_validation', 'catalogItem', 'catalogItemKey')
  assertUnique(projectionKeys, 'export_validation', 'figurePrototype', 'projectionKey')
  assertUnique(sourceRecordKeys, 'export_validation', 'sourceRecord', 'sourceRecordKey')
  assertUnique(imageRefKeys, 'export_validation', 'imageRef', 'imageRefKey')

  const characterSet = new Set(characterKeys)
  const catalogItemMap = new Map(bundle.catalogItems.map((item) => [item.catalogItemKey, item]))
  const prototypeMap = new Map(
    bundle.figurePrototypes.map((prototype) => [prototype.projectionKey, prototype]),
  )
  const membershipCount = new Map<string, number>()
  let orphanRefs = 0

  for (const item of bundle.catalogItems) {
    if (!characterSet.has(item.characterKey)) {
      orphanRefs += 1
      fail('export_validation', 'catalogItem', item.catalogItemKey, 'Unknown characterKey.')
    }
    const prototype = prototypeMap.get(item.prototypeKey)
    if (!prototype || !prototype.catalogItemKeys.includes(item.catalogItemKey)) {
      orphanRefs += 1
      fail(
        'export_validation',
        'catalogItem',
        item.catalogItemKey,
        'Missing FigurePrototype membership.',
      )
    }
    if (prototype.characterKey !== item.characterKey) {
      fail(
        'export_validation',
        'catalogItem',
        item.catalogItemKey,
        'Character membership mismatch.',
      )
    }
    for (const image of item.imageRefs) {
      if (image.catalogItemKey !== item.catalogItemKey) {
        orphanRefs += 1
        fail('export_validation', 'imageRef', image.imageRefKey, 'ImageRef CatalogItem mismatch.')
      }
    }
  }

  for (const prototype of bundle.figurePrototypes) {
    if (!characterSet.has(prototype.characterKey)) {
      orphanRefs += 1
      fail('export_validation', 'figurePrototype', prototype.projectionKey, 'Unknown characterKey.')
    }
    const expectedFingerprint = buildMembershipFingerprint(prototype.catalogItemKeys)
    if (prototype.membershipFingerprint !== expectedFingerprint) {
      fail(
        'export_validation',
        'figurePrototype',
        prototype.projectionKey,
        'membershipFingerprint does not match sorted CatalogItem membership.',
      )
    }
    for (const catalogItemKey of prototype.catalogItemKeys) {
      const item = catalogItemMap.get(catalogItemKey)
      if (!item || item.prototypeKey !== prototype.projectionKey) {
        orphanRefs += 1
        fail(
          'export_validation',
          'figurePrototype',
          prototype.projectionKey,
          `Unknown or mismatched CatalogItem membership: ${catalogItemKey}.`,
        )
      }
      membershipCount.set(catalogItemKey, (membershipCount.get(catalogItemKey) ?? 0) + 1)
    }
  }

  for (const catalogItemKey of catalogItemKeys) {
    if (membershipCount.get(catalogItemKey) !== 1) {
      fail(
        'export_validation',
        'catalogItem',
        catalogItemKey,
        'Every CatalogItem must belong to exactly one FigurePrototype.',
      )
    }
  }

  for (const sourceRecord of bundle.sourceRecords) {
    const item = catalogItemMap.get(sourceRecord.catalogItemKey)
    if (!item) {
      orphanRefs += 1
      fail(
        'export_validation',
        'sourceRecord',
        sourceRecord.sourceRecordKey,
        'Unknown CatalogItem.',
      )
    }
    if (
      sourceRecord.characterKey !== item.characterKey ||
      !characterSet.has(sourceRecord.characterKey)
    ) {
      fail(
        'export_validation',
        'sourceRecord',
        sourceRecord.sourceRecordKey,
        'SourceRecord character relation mismatch.',
      )
    }
    const expectedKey = buildSourceRecordKey(sourceRecord.sourceFamily, sourceRecord.sourceUrl)
    if (sourceRecord.sourceRecordKey !== expectedKey) {
      fail(
        'export_validation',
        'sourceRecord',
        sourceRecord.sourceRecordKey,
        'sourceRecordKey does not match source family and exact URL.',
      )
    }
    const { businessDigest: _businessDigest, ...digestInput } = sourceRecord
    const expectedDigest = buildSourceRecordBusinessDigest(digestInput)
    if (sourceRecord.businessDigest !== expectedDigest) {
      fail(
        'export_validation',
        'sourceRecord',
        sourceRecord.sourceRecordKey,
        'SourceRecord businessDigest mismatch.',
      )
    }
  }

  const canonical = createFormalBridgeBundle(semanticFromBundle(bundle))
  if (bundle.contentDigest !== canonical.contentDigest) {
    fail(
      'export_validation',
      'bundle',
      'catalog-export',
      'contentDigest does not match semantic data.',
    )
  }

  return { counts: countBundle(bundle), duplicateIds: 0, orphanRefs }
}

function findFirstDifference(left: unknown, right: unknown, path = '$'): string | null {
  if (Object.is(left, right)) return null
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return `${path}.length`
    for (let index = 0; index < left.length; index += 1) {
      const difference = findFirstDifference(left[index], right[index], `${path}[${index}]`)
      if (difference) return difference
    }
    return null
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = uniqueSorted([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      if (!(key in left) || !(key in right)) return `${path}.${key}`
      const difference = findFirstDifference(left[key], right[key], `${path}.${key}`)
      if (difference) return difference
    }
    return null
  }
  return path
}

export function validateFormalBridgeParity(
  expectedCandidate: unknown,
  actualCandidate: unknown,
): FormalBridgeParityResult {
  const expected = parseBundle(expectedCandidate)
  const actual = parseBundle(actualCandidate)
  validateFormalBridgeBundle(expected)
  validateFormalBridgeBundle(actual)
  const expectedSemantic = canonicalizeFormalBridgeSemanticBundle(semanticFromBundle(expected))
  const actualSemantic = canonicalizeFormalBridgeSemanticBundle(semanticFromBundle(actual))
  const difference = findFirstDifference(expectedSemantic, actualSemantic)
  if (difference) {
    fail('parity', 'bundle', difference, 'Formal read-back differs from the local semantic export.')
  }
  return { contentDigest: expected.contentDigest, equal: true }
}

export function resolveFormalBridgeInputPaths(
  options: ResolveFormalBridgeInputPathsOptions,
): FormalBridgeInputPaths {
  const personalGallery = join(options.runtimeRoot, 'personal-gallery', 'characters')
  const characterPaths = (
    slug: 'cheshire' | 'rem',
  ): Omit<FormalBridgeCharacterInputPaths, 'catalog'> => ({
    config: join(personalGallery, slug, 'config.json'),
    identityRegistry: join(personalGallery, slug, 'prototype-identities.json'),
    projection: join(personalGallery, slug, 'prototype-projection.json'),
  })
  return {
    cheshire: {
      ...characterPaths('cheshire'),
      catalog:
        options.cheshireCatalogPath ??
        join(
          options.runtimeRoot,
          'character-figure-collector-final',
          'cheshire',
          'projection-input.json',
        ),
    },
    rem: { ...characterPaths('rem'), catalog: options.remCatalogPath },
  }
}

async function loadJson(label: string, path: string): Promise<LoadedJson> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    fail(
      'export_input',
      'input',
      label,
      `Unable to read input: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  let data: unknown
  try {
    data = JSON.parse(bytes.toString('utf8')) as unknown
  } catch (error) {
    fail(
      'export_input',
      'input',
      label,
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return {
    data,
    manifestEntry: { byteLength: bytes.byteLength, label, sha256: sha256(bytes) },
  }
}

async function loadCharacterInputs(
  slug: 'cheshire' | 'rem',
  paths: FormalBridgeCharacterInputPaths,
): Promise<CharacterBuildInputs> {
  const [catalog, config, identityRegistry, projection] = await Promise.all([
    loadJson(`${slug}.catalog-items`, paths.catalog),
    loadJson(`${slug}.character-config`, paths.config),
    loadJson(`${slug}.prototype-identities`, paths.identityRegistry),
    loadJson(`${slug}.prototype-projection`, paths.projection),
  ])
  return { catalog, config, identityRegistry, projection }
}

function stringArray(
  value: unknown,
  phase: string,
  recordType: string,
  stableKey: string,
  field: string,
): string[] {
  return requireArray(value, phase, recordType, stableKey).map((item, index) =>
    requireString(item, phase, recordType, stableKey, `${field}[${index}]`),
  )
}

function assertSameStringSet(
  expected: string[],
  actual: string[],
  recordType: string,
  stableKey: string,
  field: string,
): void {
  if (JSON.stringify(uniqueSorted(expected)) !== JSON.stringify(uniqueSorted(actual))) {
    fail(
      'export_input',
      recordType,
      stableKey,
      `${field} differs between Projection and Collector.`,
    )
  }
}

function rawCatalogItems(catalog: unknown, slug: string): JsonRecord[] {
  const rootItems = Array.isArray(catalog)
    ? catalog
    : requireArray(
        requireRecord(catalog, 'export_input', 'catalog', slug).items,
        'export_input',
        'catalogItem',
        slug,
      )
  return rootItems.map((item, index) =>
    requireRecord(item, 'export_input', 'catalogItem', `${slug}.raw[${index}]`),
  )
}

function projectionInputDigestKey(slug: string): string {
  return slug === 'rem' ? 'figures.json' : 'projection-input.json'
}

function classificationToFigureType(
  classification: FormalBridgeClassification,
): FormalBridgeFigureType {
  if (classification === 'likely_scale') return 'scale'
  if (classification === 'likely_prize') return 'prize'
  return 'static'
}

function createSourceRecord(input: {
  catalogItemKey: string
  characterKey: string
  sourceFamily: FormalBridgeSourceFamily
  sourceLabel: string | null
  sourceRole: string | null
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

function buildCharacterExport(
  slug: 'cheshire' | 'rem',
  inputs: CharacterBuildInputs,
): CharacterBuildResult {
  const phase = 'export_input'
  const config = requireRecord(inputs.config.data, phase, 'characterConfig', slug)
  const configSlug = requireString(config.slug, phase, 'characterConfig', slug, 'slug')
  if (configSlug !== slug) {
    fail(phase, 'characterConfig', slug, `Expected character slug ${slug}, received ${configSlug}.`)
  }
  const aliases = stringArray(config.aliases, phase, 'characterConfig', slug, 'aliases')
  const character: FormalBridgeCharacter = {
    aliases: uniqueSorted(aliases),
    characterKey: slug,
    displayName: requireString(config.displayName, phase, 'characterConfig', slug, 'displayName'),
    slug,
  }

  const projection = requireRecord(inputs.projection.data, phase, 'projection', slug)
  if (projection.schemaVersion !== 2 || projection.characterSlug !== slug) {
    fail(phase, 'projection', slug, 'Projection schema version or character slug mismatch.')
  }
  if (projection.groupingConflictCount !== 0) {
    fail(phase, 'projection', slug, 'Projection contains grouping conflicts.')
  }
  const prototypes = requireArray(projection.prototypes, phase, 'figurePrototype', slug).map(
    (value, index) =>
      requireRecord(value, phase, 'figurePrototype', `${slug}.prototypes[${index}]`),
  )
  if (
    requireInteger(projection.prototypeCount, phase, 'projection', slug, 'prototypeCount') !==
    prototypes.length
  ) {
    fail(phase, 'projection', slug, 'Declared prototype count does not match Projection data.')
  }

  const rawItems = rawCatalogItems(inputs.catalog.data, slug)
  const rawMap = new Map<string, JsonRecord>()
  for (const [index, rawItem] of rawItems.entries()) {
    const rawKey = requireString(rawItem.id, phase, 'catalogItem', `${slug}.raw[${index}]`, 'id')
    if (rawMap.has(rawKey))
      fail(phase, 'catalogItem', rawKey, 'Duplicate Collector CatalogItem ID.')
    rawMap.set(rawKey, rawItem)
  }

  const embeddedInputs = requireRecord(projection.inputs, phase, 'projection', slug)
  const digestKey = projectionInputDigestKey(slug)
  if (embeddedInputs[digestKey] !== inputs.catalog.manifestEntry.sha256) {
    fail(
      phase,
      'projection',
      slug,
      `Projection input digest for ${digestKey} does not match the selected Collector JSON.`,
    )
  }

  const registry = requireRecord(inputs.identityRegistry.data, phase, 'identityRegistry', slug)
  if (registry.schemaVersion !== 1 || registry.characterSlug !== slug) {
    fail(phase, 'identityRegistry', slug, 'Identity registry schema version or character mismatch.')
  }
  const registryPrototypes = requireRecord(registry.prototypes, phase, 'identityRegistry', slug)

  const outputCatalogItems: FormalBridgeCatalogItem[] = []
  const outputPrototypes: FormalBridgeFigurePrototype[] = []
  const outputSourceRecords: FormalBridgeSourceRecord[] = []
  const projectedCatalogKeys: string[] = []
  const projectionKeys: string[] = []
  let projectionImageCount = 0

  for (const [prototypeIndex, prototype] of prototypes.entries()) {
    const projectionKey = requireString(
      prototype.prototypeId,
      phase,
      'figurePrototype',
      `${slug}.prototypes[${prototypeIndex}]`,
      'prototypeId',
    )
    projectionKeys.push(projectionKey)
    if (!projectionKey.startsWith(`${slug}-proto-`)) {
      fail(
        phase,
        'figurePrototype',
        projectionKey,
        'Projection identity is outside its character namespace.',
      )
    }
    const membershipFingerprint = requireString(
      prototype.membershipFingerprint,
      phase,
      'figurePrototype',
      projectionKey,
      'membershipFingerprint',
    )
    if (!isSha256(membershipFingerprint)) {
      fail(phase, 'figurePrototype', projectionKey, 'membershipFingerprint is not SHA-256.')
    }
    const catalogItemKeys = stringArray(
      prototype.catalogItemIds,
      phase,
      'figurePrototype',
      projectionKey,
      'catalogItemIds',
    )
    assertUnique(catalogItemKeys, phase, 'figurePrototype', 'catalogItemId')
    if (membershipFingerprint !== buildMembershipFingerprint(catalogItemKeys)) {
      fail(
        phase,
        'figurePrototype',
        projectionKey,
        'Projection membershipFingerprint does not match its sorted CatalogItem IDs.',
      )
    }
    const registryEntry = requireRecord(
      registryPrototypes[projectionKey],
      phase,
      'identityRegistry',
      projectionKey,
    )
    if (registryEntry.prototypeId !== projectionKey) {
      fail(phase, 'identityRegistry', projectionKey, 'Registry prototypeId mismatch.')
    }
    if (registryEntry.membershipFingerprint !== membershipFingerprint) {
      fail(phase, 'identityRegistry', projectionKey, 'Registry membershipFingerprint mismatch.')
    }
    assertSameStringSet(
      catalogItemKeys,
      stringArray(
        registryEntry.catalogItemIds,
        phase,
        'identityRegistry',
        projectionKey,
        'catalogItemIds',
      ),
      'identityRegistry',
      projectionKey,
      'CatalogItem membership',
    )

    const projectionItems = requireArray(
      prototype.catalogItems,
      phase,
      'catalogItem',
      projectionKey,
    ).map((value, index) =>
      requireRecord(value, phase, 'catalogItem', `${projectionKey}.catalogItems[${index}]`),
    )
    const projectionItemKeys = projectionItems.map((item, index) =>
      requireString(item.id, phase, 'catalogItem', `${projectionKey}[${index}]`, 'id'),
    )
    assertSameStringSet(
      catalogItemKeys,
      projectionItemKeys,
      'figurePrototype',
      projectionKey,
      'embedded CatalogItem membership',
    )

    const images = requireArray(prototype.images, phase, 'imageRef', projectionKey).map(
      (value, index) =>
        requireRecord(value, phase, 'imageRef', `${projectionKey}.images[${index}]`),
    )
    projectionImageCount += images.length
    const imagesByItem = new Map<string, FormalBridgeImageRef[]>()
    for (const [imageIndex, image] of images.entries()) {
      const imageRefKey = requireString(
        image.id,
        phase,
        'imageRef',
        `${projectionKey}.images[${imageIndex}]`,
        'id',
      )
      const catalogItemKey = requireString(
        image.catalogItemId,
        phase,
        'imageRef',
        imageRefKey,
        'catalogItemId',
      )
      if (!catalogItemKeys.includes(catalogItemKey)) {
        fail(
          phase,
          'imageRef',
          imageRefKey,
          'ImageRef points outside its FigurePrototype membership.',
        )
      }
      const url = requireString(image.url, phase, 'imageRef', imageRefKey, 'url')
      assertHttpUrl(url, phase, 'imageRef', imageRefKey, 'url')
      const outputImage: FormalBridgeImageRef = {
        catalogItemKey,
        imageRefKey,
        isMain: requireBoolean(image.isMain, phase, 'imageRef', imageRefKey, 'isMain'),
        sourceFamily: requireSourceFamily(image.sourceFamily, phase, 'imageRef', imageRefKey),
        url,
      }
      const itemImages = imagesByItem.get(catalogItemKey) ?? []
      itemImages.push(outputImage)
      imagesByItem.set(catalogItemKey, itemImages)
    }

    const classification = requireClassification(
      prototype.classification,
      phase,
      'figurePrototype',
      projectionKey,
    )
    const prototypeScales = uniqueSorted(
      projectionItems
        .map((item) => nullableString(item.scale))
        .filter((value): value is string => value !== null),
    )
    if (prototypeScales.length > 1) {
      fail(
        phase,
        'figurePrototype',
        projectionKey,
        'Prototype members contain conflicting scale values.',
      )
    }
    const explicitIsGroup = prototype.isGroup
    if (explicitIsGroup !== undefined && typeof explicitIsGroup !== 'boolean') {
      fail(phase, 'figurePrototype', projectionKey, 'isGroup must be boolean when present.')
    }
    outputPrototypes.push({
      catalogItemKeys: uniqueSorted(catalogItemKeys),
      characterKey: slug,
      figureType: classificationToFigureType(classification),
      isGroup: explicitIsGroup === true,
      membershipFingerprint,
      projectionKey,
      scale: prototypeScales[0] ?? null,
      title: requireString(prototype.title, phase, 'figurePrototype', projectionKey, 'title'),
    })

    for (const projectionItem of projectionItems) {
      const catalogItemKey = requireString(
        projectionItem.id,
        phase,
        'catalogItem',
        projectionKey,
        'id',
      )
      projectedCatalogKeys.push(catalogItemKey)
      const rawItem = rawMap.get(catalogItemKey)
      if (!rawItem) {
        fail(
          phase,
          'catalogItem',
          catalogItemKey,
          'Projection CatalogItem is missing from Collector JSON.',
        )
      }
      for (const field of ['title', 'manufacturer', 'category', 'scale', 'release']) {
        if (nullableString(projectionItem[field]) !== nullableString(rawItem[field])) {
          fail(
            phase,
            'catalogItem',
            catalogItemKey,
            `${field} differs between Projection and Collector JSON.`,
          )
        }
      }
      const sourceUrls = stringArray(
        projectionItem.sourceUrls,
        phase,
        'catalogItem',
        catalogItemKey,
        'sourceUrls',
      )
      assertSameStringSet(
        sourceUrls,
        stringArray(rawItem.source_urls, phase, 'catalogItem', catalogItemKey, 'source_urls'),
        'catalogItem',
        catalogItemKey,
        'source URLs',
      )
      const itemImages = imagesByItem.get(catalogItemKey) ?? []
      assertSameStringSet(
        itemImages.map((image) => image.url),
        stringArray(rawItem.image_urls, phase, 'catalogItem', catalogItemKey, 'image_urls'),
        'catalogItem',
        catalogItemKey,
        'image URLs',
      )
      const sourceObjects = requireArray(
        projectionItem.sources,
        phase,
        'sourceRecord',
        catalogItemKey,
      ).map((value, index) =>
        requireRecord(value, phase, 'sourceRecord', `${catalogItemKey}.sources[${index}]`),
      )
      assertSameStringSet(
        sourceUrls,
        sourceObjects.map((source, index) =>
          requireString(
            source.url,
            phase,
            'sourceRecord',
            `${catalogItemKey}.sources[${index}]`,
            'url',
          ),
        ),
        'catalogItem',
        catalogItemKey,
        'structured sources',
      )
      for (const source of sourceObjects) {
        const sourceUrl = requireString(source.url, phase, 'sourceRecord', catalogItemKey, 'url')
        assertHttpUrl(sourceUrl, phase, 'sourceRecord', catalogItemKey, 'url')
        outputSourceRecords.push(
          createSourceRecord({
            catalogItemKey,
            characterKey: slug,
            sourceFamily: requireSourceFamily(
              source.sourceFamily,
              phase,
              'sourceRecord',
              catalogItemKey,
            ),
            sourceLabel: nullableString(source.label),
            sourceRole: nullableString(source.role),
            sourceUrl,
          }),
        )
      }
      outputCatalogItems.push({
        catalogItemKey,
        category: nullableString(projectionItem.category),
        characterKey: slug,
        classification: requireClassification(
          projectionItem.classification,
          phase,
          'catalogItem',
          catalogItemKey,
        ),
        description: nullableString(rawItem.specifications),
        heightMm:
          typeof rawItem.height_mm === 'number' && Number.isFinite(rawItem.height_mm)
            ? rawItem.height_mm
            : null,
        imageRefs: itemImages,
        manufacturerText: requireString(
          projectionItem.manufacturer,
          phase,
          'catalogItem',
          catalogItemKey,
          'manufacturer',
        ),
        productType: nullableString(rawItem.source_product_type),
        prototypeKey: projectionKey,
        release: nullableString(projectionItem.release),
        scale: nullableString(projectionItem.scale),
        series: nullableString(rawItem.series),
        title: requireString(projectionItem.title, phase, 'catalogItem', catalogItemKey, 'title'),
      })
    }
  }

  assertUnique(projectionKeys, phase, 'figurePrototype', 'projectionKey')
  assertUnique(projectedCatalogKeys, phase, 'catalogItem', 'catalogItemKey')
  assertUnique(
    outputSourceRecords.map((record) => record.sourceRecordKey),
    phase,
    'sourceRecord',
    'sourceRecordKey',
  )
  assertUnique(
    outputCatalogItems.flatMap((item) => item.imageRefs.map((image) => image.imageRefKey)),
    phase,
    'imageRef',
    'imageRefKey',
  )
  assertSameStringSet(
    projectionKeys,
    Object.keys(registryPrototypes),
    'identityRegistry',
    slug,
    'active Prototype identities',
  )
  const declaredItems = requireInteger(
    projection.projectionEligibleItemCount,
    phase,
    'projection',
    slug,
    'projectionEligibleItemCount',
  )
  if (declaredItems !== outputCatalogItems.length) {
    fail(phase, 'projection', slug, 'Declared eligible CatalogItem count mismatch.')
  }
  if (
    requireInteger(projection.imageRefCount, phase, 'projection', slug, 'imageRefCount') !==
    projectionImageCount
  ) {
    fail(phase, 'projection', slug, 'Declared ImageRef count mismatch.')
  }

  return {
    catalogItems: outputCatalogItems,
    character,
    figurePrototypes: outputPrototypes,
    rawCatalogItemCount: rawItems.length,
    sourceRecords: outputSourceRecords,
  }
}

function assertExpectedBaseline(
  result: FormalBridgeExportResult,
  rawCatalogCounts: Record<string, number>,
  expected: FormalBridgeExpectedBaseline,
): void {
  const counts = result.validation.counts
  for (const [field, actual, wanted] of [
    ['characters', counts.characters, expected.characters],
    ['sourceRecords', counts.sourceRecords, expected.sourceRecords],
    ['catalogItems', counts.catalogItems, expected.catalogItems],
    ['figurePrototypes', counts.figurePrototypes, expected.figurePrototypes],
    ['imageRefs', counts.imageRefs, expected.imageRefs],
  ] as const) {
    if (actual !== wanted) {
      fail('export_baseline', 'bundle', field, `Expected ${wanted}, received ${actual}.`)
    }
  }
  for (const sourceFamily of FORMAL_BRIDGE_SOURCE_FAMILIES) {
    if (counts.imageProvenance[sourceFamily] !== expected.imageProvenance[sourceFamily]) {
      fail(
        'export_baseline',
        'imageRef',
        sourceFamily,
        `Expected ${expected.imageProvenance[sourceFamily]} images, received ${counts.imageProvenance[sourceFamily]}.`,
      )
    }
    if (counts.sourceProvenance[sourceFamily] !== expected.sourceProvenance[sourceFamily]) {
      fail(
        'export_baseline',
        'sourceRecord',
        sourceFamily,
        `Expected ${expected.sourceProvenance[sourceFamily]} records, received ${counts.sourceProvenance[sourceFamily]}.`,
      )
    }
  }
  for (const [characterKey, characterExpected] of Object.entries(expected.byCharacter)) {
    const actual = counts.byCharacter[characterKey]
    if (!actual)
      fail('export_baseline', 'character', characterKey, 'Expected character is missing.')
    for (const field of [
      'catalogItems',
      'figurePrototypes',
      'imageRefs',
      'sourceRecords',
    ] as const) {
      if (actual[field] !== characterExpected[field]) {
        fail(
          'export_baseline',
          'character',
          characterKey,
          `${field}: expected ${characterExpected[field]}, received ${actual[field]}.`,
        )
      }
    }
    if (rawCatalogCounts[characterKey] !== characterExpected.rawCatalogItems) {
      fail(
        'export_baseline',
        'catalog',
        characterKey,
        `Raw CatalogItem count: expected ${characterExpected.rawCatalogItems}, received ${rawCatalogCounts[characterKey]}.`,
      )
    }
  }
}

export async function buildFormalBridgeExport(
  paths: FormalBridgeInputPaths,
  options: BuildFormalBridgeExportOptions = {},
): Promise<FormalBridgeExportResult> {
  const [remInputs, cheshireInputs] = await Promise.all([
    loadCharacterInputs('rem', paths.rem),
    loadCharacterInputs('cheshire', paths.cheshire),
  ])
  const rem = buildCharacterExport('rem', remInputs)
  const cheshire = buildCharacterExport('cheshire', cheshireInputs)
  const bundle = createFormalBridgeBundle({
    catalogItems: [...rem.catalogItems, ...cheshire.catalogItems],
    characters: [rem.character, cheshire.character],
    figurePrototypes: [...rem.figurePrototypes, ...cheshire.figurePrototypes],
    schemaVersion: FORMAL_BRIDGE_SCHEMA_VERSION,
    sourceRecords: [...rem.sourceRecords, ...cheshire.sourceRecords],
  })
  const validation = validateFormalBridgeBundle(bundle)
  const manifest: FormalBridgeManifest = {
    contentDigest: bundle.contentDigest,
    counts: validation.counts,
    inputs: [
      remInputs.catalog.manifestEntry,
      remInputs.config.manifestEntry,
      remInputs.identityRegistry.manifestEntry,
      remInputs.projection.manifestEntry,
      cheshireInputs.catalog.manifestEntry,
      cheshireInputs.config.manifestEntry,
      cheshireInputs.identityRegistry.manifestEntry,
      cheshireInputs.projection.manifestEntry,
    ].sort((left, right) => compareStrings(left.label, right.label)),
    schemaVersion: FORMAL_BRIDGE_SCHEMA_VERSION,
  }
  const result = { bundle, manifest, validation }
  const expectedBaseline = options.expectedBaseline ?? CURRENT_FORMAL_BRIDGE_BASELINE
  if (expectedBaseline !== false) {
    assertExpectedBaseline(
      result,
      { cheshire: cheshire.rawCatalogItemCount, rem: rem.rawCatalogItemCount },
      expectedBaseline,
    )
  }
  return result
}

export async function writeFormalBridgeExport(
  outputDirectory: string,
  result: FormalBridgeExportResult,
): Promise<{ bundlePath: string; manifestPath: string }> {
  validateFormalBridgeBundle(result.bundle)
  if (result.manifest.contentDigest !== result.bundle.contentDigest) {
    fail(
      'export_write',
      'manifest',
      'manifest',
      'Manifest contentDigest does not match export bundle.',
    )
  }
  await mkdir(outputDirectory, { recursive: true })
  const bundlePath = join(outputDirectory, 'catalog-export.json')
  const manifestPath = join(outputDirectory, 'manifest.json')
  await Promise.all([
    writeFile(bundlePath, `${JSON.stringify(result.bundle, null, 2)}\n`, 'utf8'),
    writeFile(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8'),
  ])
  return { bundlePath, manifestPath }
}

export async function readFormalBridgeBundle(path: string): Promise<FormalBridgeBundle> {
  const loaded = await loadJson('catalog-export', path)
  const bundle = parseBundle(loaded.data)
  validateFormalBridgeBundle(bundle)
  return createFormalBridgeBundle(semanticFromBundle(bundle))
}

export async function readFormalBridgeManifest(path: string): Promise<FormalBridgeManifest> {
  const loaded = await loadJson('manifest', path)
  const root = requireRecord(loaded.data, 'export_validation', 'manifest', 'manifest')
  if (root.schemaVersion !== FORMAL_BRIDGE_SCHEMA_VERSION || !isSha256(root.contentDigest)) {
    fail('export_validation', 'manifest', 'manifest', 'Invalid manifest schema or contentDigest.')
  }
  const inputs = requireArray(root.inputs, 'export_validation', 'manifest', 'manifest').map(
    (value, index): FormalBridgeInputManifestEntry => {
      const record = requireRecord(value, 'export_validation', 'manifest', `inputs[${index}]`)
      const label = requireString(
        record.label,
        'export_validation',
        'manifest',
        `inputs[${index}]`,
        'label',
      )
      if (!isSha256(record.sha256)) {
        fail('export_validation', 'manifest', label, 'Input sha256 must be a lowercase digest.')
      }
      return {
        byteLength: requireInteger(
          record.byteLength,
          'export_validation',
          'manifest',
          label,
          'byteLength',
        ),
        label,
        sha256: record.sha256,
      }
    },
  )
  assertUnique(
    inputs.map((entry) => entry.label),
    'export_validation',
    'manifest',
    'input label',
  )
  const counts = requireRecord(root.counts, 'export_validation', 'manifest', 'counts')
  return {
    contentDigest: root.contentDigest,
    counts: counts as unknown as FormalBridgeCountSummary,
    inputs: [...inputs].sort((left, right) => compareStrings(left.label, right.label)),
    schemaVersion: FORMAL_BRIDGE_SCHEMA_VERSION,
  }
}
