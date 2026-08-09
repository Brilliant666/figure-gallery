import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  BUILTIN_CHARACTERS,
  normalizeCharacterLookup,
  resolveBuiltinCharacter,
  validateCharacterConfig,
} from '../characters/registry.js'
import { businessFields, fieldDigest, productIdentity } from './identity.js'
import { atomicWriteJson, readJson } from './json-files.js'

export const EMPTY_CHARACTER_PREFERENCES = Object.freeze({
  schemaVersion: 2,
  excludedProductIds: [],
  excludedImageSha256: [],
  products: {},
  preferredCoverImage: {},
  manualNote: {},
})

function unique(values = []) {
  return [...new Set(values.filter(Boolean))]
}

export function characterDirectory(root, slug) {
  return path.join(path.resolve(root), 'characters', slug)
}

export function characterConfigPath(root, slug) {
  return path.join(characterDirectory(root, slug), 'config.json')
}

export function characterIndexPath(root, slug) {
  return path.join(characterDirectory(root, slug), 'index.json')
}

export function characterPreferencesPath(root, slug) {
  return path.join(characterDirectory(root, slug), 'preferences.json')
}

function runMatchesCharacter(run, character) {
  const values = [run?.characterId, run?.characterSlug, run?.query, run?.characterName, run?.input?.query]
    .map(normalizeCharacterLookup)
    .filter(Boolean)
  const accepted = new Set([
    normalizeCharacterLookup(character.characterId),
    normalizeCharacterLookup(character.slug),
    ...character.aliases.map(normalizeCharacterLookup),
  ])
  return values.some((value) => accepted.has(value))
}

async function listRunIds(root) {
  try {
    return (await fs.readdir(path.join(root, 'runs'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function existingCharacterConfigs(root) {
  const values = []
  try {
    const entries = await fs.readdir(path.join(root, 'characters'), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const raw = await readJson(characterConfigPath(root, entry.name))
      if (!raw) continue
      try { values.push(validateCharacterConfig(raw)) } catch { /* malformed local config is not activated */ }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return values
}

export async function listCharacterConfigs(root) {
  const result = new Map(BUILTIN_CHARACTERS.map((character) => [character.characterId, character]))
  for (const character of await existingCharacterConfigs(root)) {
    const builtin = result.get(character.characterId)
    if (!builtin) {
      result.set(character.characterId, character)
      continue
    }
    const seedByUrl = new Map(
      [...builtin.reviewedSeeds, ...character.reviewedSeeds].map((seed) => [seed.url, seed]),
    )
    result.set(character.characterId, validateCharacterConfig({
      ...character,
      aliases: unique([...builtin.aliases, ...character.aliases]),
      workNames: unique([...builtin.workNames, ...character.workNames]),
      productTerms: unique([...builtin.productTerms, ...character.productTerms]),
      discoveryQueries: unique([...builtin.discoveryQueries, ...character.discoveryQueries]),
      conflictingAliases: unique([...builtin.conflictingAliases, ...character.conflictingAliases]),
      reviewedSeeds: [...seedByUrl.values()],
    }))
  }
  return [...result.values()].sort((left, right) => left.slug.localeCompare(right.slug))
}

export async function resolveCharacterConfig(root, value) {
  const wanted = normalizeCharacterLookup(value)
  if (!wanted) return null
  const local = (await listCharacterConfigs(root)).find((character) =>
    normalizeCharacterLookup(character.characterId) === wanted ||
    normalizeCharacterLookup(character.slug) === wanted ||
    character.aliases.some((alias) => normalizeCharacterLookup(alias) === wanted),
  )
  return local || resolveBuiltinCharacter(value)
}

export async function createLocalCharacterConfig(root, input) {
  const character = validateCharacterConfig(input)
  const existing = await listCharacterConfigs(root)
  const conflict = existing.find((candidate) =>
    candidate.characterId !== character.characterId &&
    (candidate.slug === character.slug || candidate.aliases.some((alias) =>
      character.aliases.some((other) => normalizeCharacterLookup(alias) === normalizeCharacterLookup(other)),
    )),
  )
  if (conflict) throw new Error(`Character config conflicts with ${conflict.displayName}.`)
  await ensureCharacterStorage(root, character)
  await atomicWriteJson(characterConfigPath(root, character.slug), character)
  return character
}

async function migrateProductRecords(root, character, matchingRuns, preferences) {
  const mapping = new Map()
  const productsRoot = path.join(root, 'products')
  await fs.mkdir(productsRoot, { recursive: true })

  for (const { runId } of matchingRuns) {
    const productsPath = path.join(root, 'runs', runId, 'products.json')
    const products = await readJson(productsPath, [])
    let changed = false
    for (const entry of Array.isArray(products) ? products : []) {
      if (!entry || typeof entry !== 'object') continue
      const oldKey = String(entry.productKey || '')
      if (!oldKey) {
        entry.characterId = character.characterId
        entry.characterSlug = character.slug
        if (entry.fields && typeof entry.fields === 'object') {
          entry.fields = { ...entry.fields, characterId: character.characterId, characterSlug: character.slug }
        }
        changed = true
        continue
      }
      const oldRecord = oldKey ? await readJson(path.join(productsRoot, `${oldKey}.json`)) : null
      const fields = {
        ...(oldRecord?.fields || entry.fields || {}),
        characterId: character.characterId,
        characterSlug: character.slug,
      }
      let identity
      try {
        identity = productIdentity(fields)
      } catch {
        if (entry.fields && typeof entry.fields === 'object') entry.fields = fields
        continue
      }
      const newKey = identity.key
      if (!oldKey || oldKey === newKey) {
        entry.productKey = newKey
        if (entry.fields && typeof entry.fields === 'object' && JSON.stringify(entry.fields) !== JSON.stringify(fields)) {
          entry.fields = fields
          changed = true
        }
        continue
      }
      mapping.set(oldKey, newKey)
      const existingNew = await readJson(path.join(productsRoot, `${newKey}.json`))
      const imageSha256 = unique([
        ...(existingNew?.imageSha256 || []),
        ...(oldRecord?.imageSha256 || []),
        ...(entry.imageSha256 || []),
      ])
      const record = {
        ...(oldRecord || existingNew || {}),
        schemaVersion: Math.max(1, Number(oldRecord?.schemaVersion || existingNew?.schemaVersion) || 1),
        productKey: newKey,
        identity,
        fields,
        fieldDigest: fieldDigest(businessFields(fields)),
        imageSha256,
      }
      await atomicWriteJson(path.join(productsRoot, `${newKey}.json`), record)
      entry.productKey = newKey
      entry.fields = fields
      entry.imageSha256 = unique([...(entry.imageSha256 || []), ...imageSha256])
      changed = true
    }
    if (changed) await atomicWriteJson(productsPath, products)
  }

  if (mapping.size === 0) return preferences
  const remapList = (values = []) => unique(values.map((value) => mapping.get(value) || value))
  const remapObject = (value = {}) => Object.fromEntries(
    Object.entries(value || {}).map(([key, item]) => [mapping.get(key) || key, item]),
  )
  const migratedPreferences = {
    ...preferences,
    excludedProductIds: remapList(preferences.excludedProductIds),
    products: remapObject(preferences.products),
    preferredCoverImage: remapObject(preferences.preferredCoverImage),
    manualNote: remapObject(preferences.manualNote),
  }
  const imageIndexPath = path.join(root, 'image-index.json')
  const imageIndex = await readJson(imageIndexPath)
  if (imageIndex?.objects && typeof imageIndex.objects === 'object') {
    for (const object of Object.values(imageIndex.objects)) {
      object.productKeys = remapList(object.productKeys)
    }
    await atomicWriteJson(imageIndexPath, imageIndex)
  }
  return migratedPreferences
}

export async function ensureCharacterStorage(root, input) {
  const character = validateCharacterConfig(input)
  const directory = characterDirectory(root, character.slug)
  await fs.mkdir(directory, { recursive: true })
  const configPath = characterConfigPath(root, character.slug)
  const storedConfig = await readJson(configPath)
  if (JSON.stringify(storedConfig) !== JSON.stringify(character)) await atomicWriteJson(configPath, character)

  const matchingRuns = []
  for (const runId of await listRunIds(root)) {
    const runPath = path.join(root, 'runs', runId, 'run.json')
    const run = await readJson(runPath)
    if (!run || !runMatchesCharacter(run, character)) continue
    const next = {
      ...run,
      characterId: character.characterId,
      characterSlug: character.slug,
      characterDisplayName: character.displayName,
    }
    if (JSON.stringify(next) !== JSON.stringify(run)) await atomicWriteJson(runPath, next)
    matchingRuns.push({
      runId,
      run: next,
      legacyCharacterContext: !run.characterId && !run.characterDisplayName,
    })
  }

  const preferencesPath = characterPreferencesPath(root, character.slug)
  let preferences = await readJson(preferencesPath)
  if (preferences === null) {
    const legacy = matchingRuns.some((entry) => entry.legacyCharacterContext)
      ? await readJson(path.join(root, 'preferences.json'), EMPTY_CHARACTER_PREFERENCES)
      : EMPTY_CHARACTER_PREFERENCES
    preferences = structuredClone(legacy || EMPTY_CHARACTER_PREFERENCES)
  }
  preferences = await migrateProductRecords(root, character, matchingRuns, preferences)
  await atomicWriteJson(preferencesPath, preferences)

  const previousIndex = await readJson(characterIndexPath(root, character.slug), {})
  const matchingRunIds = matchingRuns.map(({ runId }) => runId)
  const matchingRunIdSet = new Set(matchingRunIds)
  const index = {
    schemaVersion: 1,
    characterId: character.characterId,
    slug: character.slug,
    displayName: character.displayName,
    aliases: [...character.aliases],
    workNames: [...character.workNames],
    // Preserve the explicit newest-first ordering written by addCharacterRun().
    // Re-sorting directory names here breaks caller-supplied run IDs and can
    // make an older completed run shadow the latest gallery snapshot.
    runs: unique([
      ...(previousIndex?.runs || []).filter((runId) => matchingRunIdSet.has(runId)),
      ...matchingRunIds,
    ]),
  }
  await atomicWriteJson(characterIndexPath(root, character.slug), index)
  return { character, directory, index, preferences }
}

export async function addCharacterRun(root, character, runId) {
  const state = await ensureCharacterStorage(root, character)
  const index = { ...state.index, runs: unique([runId, ...(state.index.runs || [])]) }
  await atomicWriteJson(characterIndexPath(root, character.slug), index)
  return index
}

export async function listCharacterRunIds(root, input) {
  const character = validateCharacterConfig(input)
  const state = await ensureCharacterStorage(root, character)
  return [...(state.index.runs || [])]
}
