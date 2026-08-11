import { constants as fsConstants } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

import { mergeGalleryPrototypeNotes } from '../../../../packages/gallery-read-model/src/index.js'
import { atomicWriteJson, readJson } from '../storage/json-files.js'

const EMPTY_PREFERENCES = Object.freeze({
  schemaVersion: 2,
  excludedProductIds: [],
  excludedImageSha256: [],
  products: {},
  preferredCoverImage: {},
  manualNote: {},
})

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))]
}

function coverValue(entry = {}, legacyValue = '') {
  return entry.preferredCoverImageUrl || entry.preferredCoverImageId || legacyValue || ''
}

function setLegacyCoverIfMissing(entry, value) {
  if (entry.preferredCoverImageUrl || entry.preferredCoverImageId || !value) return
  if (/^https:\/\//iu.test(value)) entry.preferredCoverImageUrl = value
  else entry.preferredCoverImageId = value
}

function validCover(value, prototype) {
  if (!value) return null
  for (const image of prototype?.images || []) {
    const digest = sha256(image.url)
    if (value === image.url) return { value: image.url, field: 'preferredCoverImageUrl' }
    if (value === image.id || value === digest) return { value, field: 'preferredCoverImageId' }
  }
  return null
}

function aliasesByTarget(aliases) {
  const result = new Map()
  for (const [retired, target] of Object.entries(aliases || {})) {
    const values = result.get(target) || []
    values.push(retired)
    result.set(target, values.sort())
  }
  return result
}

function setCover(entry, selected) {
  delete entry.preferredCoverImageUrl
  delete entry.preferredCoverImageId
  if (selected) entry[selected.field] = selected.value
}

export const mergePrototypeNotes = mergeGalleryPrototypeNotes

export function migratePrototypePreferences({ preferences, aliases, prototypes }) {
  const before = structuredClone(preferences || EMPTY_PREFERENCES)
  const next = {
    ...structuredClone(EMPTY_PREFERENCES),
    ...before,
    schemaVersion: 2,
    excludedProductIds: uniqueStrings(before.excludedProductIds || []),
    excludedImageSha256: uniqueStrings(before.excludedImageSha256 || []),
    products: before.products && typeof before.products === 'object'
      ? structuredClone(before.products)
      : {},
    preferredCoverImage:
      before.preferredCoverImage && typeof before.preferredCoverImage === 'object'
        ? structuredClone(before.preferredCoverImage)
        : {},
    manualNote: before.manualNote && typeof before.manualNote === 'object'
      ? structuredClone(before.manualNote)
      : {},
  }
  const prototypeById = new Map((prototypes || []).map((value) => [value.prototypeId, value]))
  const legacyProductIds = new Set([
    ...Object.keys(next.preferredCoverImage),
    ...Object.keys(next.manualNote),
  ])
  for (const prototypeId of [...legacyProductIds].sort()) {
    const entry = next.products[prototypeId] && typeof next.products[prototypeId] === 'object'
      ? next.products[prototypeId]
      : {}
    setLegacyCoverIfMissing(entry, String(next.preferredCoverImage[prototypeId] || '').trim())
    if (!entry.manualNote) {
      const note = String(next.manualNote[prototypeId] || '').trim()
      if (note) entry.manualNote = note
    }
    if (Object.keys(entry).length > 0) next.products[prototypeId] = entry
  }
  const excluded = new Set(next.excludedProductIds)
  const summary = {
    cover: 0,
    exclude: 0,
    notes: 0,
    conflicts: [],
    invalidCoverPreferences: 0,
  }

  for (const [survivor, retiredIds] of aliasesByTarget(aliases)) {
    const prototype = prototypeById.get(survivor)
    if (!prototype) throw new Error(`Preference alias target is not an active Prototype: ${survivor}.`)
    const hasRetiredFootprint = retiredIds.some((retired) => (
      excluded.has(retired) ||
      Object.hasOwn(next.products, retired) ||
      Object.hasOwn(next.preferredCoverImage, retired) ||
      Object.hasOwn(next.manualNote, retired)
    ))
    if (!hasRetiredFootprint) continue
    const allIds = [survivor, ...retiredIds]
    const survivorEntry = next.products[survivor] && typeof next.products[survivor] === 'object'
      ? next.products[survivor]
      : {}
    next.products[survivor] = survivorEntry

    const candidateCovers = allIds.map((prototypeId) => {
      const entry = next.products[prototypeId] && typeof next.products[prototypeId] === 'object'
        ? next.products[prototypeId]
        : {}
      const raw = coverValue(entry, next.preferredCoverImage[prototypeId])
      return { prototypeId, raw, valid: validCover(raw, prototype) }
    }).filter((candidate) => candidate.raw)
    const validCovers = candidateCovers.filter((candidate) => candidate.valid)
    summary.invalidCoverPreferences += candidateCovers.length - validCovers.length
    const survivorCover = validCovers.find((candidate) => candidate.prototypeId === survivor)
    const selectedCover = survivorCover || validCovers[0] || null
    const previousSurvivorCover = coverValue(survivorEntry, next.preferredCoverImage[survivor])
    setCover(survivorEntry, selectedCover?.valid || null)
    if (selectedCover && selectedCover.prototypeId !== survivor && selectedCover.valid.value !== previousSurvivorCover) {
      summary.cover += 1
    }
    const distinctCovers = uniqueStrings(validCovers.map((candidate) => candidate.valid.value))
    if (distinctCovers.length > 1) {
      summary.conflicts.push({
        kind: 'cover',
        survivorPrototypeId: survivor,
        chosen: selectedCover.valid.value,
        candidates: validCovers.map((candidate) => ({
          prototypeId: candidate.prototypeId,
          value: candidate.valid.value,
        })),
      })
    }

    const previousExcluded = excluded.has(survivor)
    const excludedCount = allIds.filter((prototypeId) => excluded.has(prototypeId)).length
    const allExcluded = excludedCount === allIds.length
    const mixedExcluded = excludedCount > 0 && !allExcluded
    if (allExcluded) excluded.add(survivor)
    else excluded.delete(survivor)
    if (previousExcluded !== excluded.has(survivor)) summary.exclude += 1
    if (mixedExcluded) {
      summary.conflicts.push({
        kind: 'exclude',
        survivorPrototypeId: survivor,
        resolution: 'visible',
        excludedPrototypeIds: allIds.filter((prototypeId) => excluded.has(prototypeId)),
      })
    }
    for (const retired of retiredIds) excluded.delete(retired)

    const notes = allIds.map((prototypeId) => {
      const entry = next.products[prototypeId] && typeof next.products[prototypeId] === 'object'
        ? next.products[prototypeId]
        : {}
      const note = String(entry.manualNote || next.manualNote[prototypeId] || '').trim()
      return { prototypeId, note }
    }).filter((value) => value.note)
    const previousNote = String(survivorEntry.manualNote || next.manualNote[survivor] || '').trim()
    const mergedNote = mergePrototypeNotes(notes)
    if (mergedNote) survivorEntry.manualNote = mergedNote
    else delete survivorEntry.manualNote
    if (mergedNote !== previousNote && notes.some((value) => value.prototypeId !== survivor)) {
      summary.notes += 1
    }
    for (const retired of retiredIds) {
      delete next.products[retired]
      delete next.preferredCoverImage[retired]
      delete next.manualNote[retired]
    }
    if (Object.keys(survivorEntry).length === 0) delete next.products[survivor]
  }

  next.excludedProductIds = [...excluded].sort()
  next.preferredCoverImage = Object.fromEntries(Object.entries(next.products)
    .map(([prototypeId, entry]) => [prototypeId, coverValue(entry)])
    .filter(([, value]) => value))
  next.manualNote = Object.fromEntries(Object.entries(next.products)
    .map(([prototypeId, entry]) => [prototypeId, String(entry.manualNote || '').trim()])
    .filter(([, value]) => value))

  return {
    preferences: next,
    changed: JSON.stringify(before) !== JSON.stringify(next),
    summary: {
      ...summary,
      conflictCount: summary.conflicts.length,
    },
  }
}

function normalizeCatalogPreferenceMappings(preferenceMap = {}) {
  if (preferenceMap.schemaVersion !== 1) {
    throw new Error('Catalog preference mapping requires schemaVersion 1.')
  }
  const globalImageUrls = preferenceMap.imageUrlBySha256 &&
    typeof preferenceMap.imageUrlBySha256 === 'object'
    ? preferenceMap.imageUrlBySha256
    : {}
  const rawMappings = Array.isArray(preferenceMap.mappings)
    ? preferenceMap.mappings.map((value) => [value?.legacyProductId, value])
    : Object.entries(preferenceMap.products || {})
  return rawMappings.map(([legacyProductId, value]) => ({
    legacyProductId: String(legacyProductId || '').trim(),
    catalogItemIds: uniqueStrings([
      value?.catalogItemId,
      ...(value?.catalogItemIds || []),
    ]),
    imageUrlBySha256: {
      ...globalImageUrls,
      ...(value?.imageUrlBySha256 || {}),
    },
  })).filter((value) => value.legacyProductId && value.catalogItemIds.length)
}

function preferenceFootprint(preferences, productId) {
  return (
    preferences.excludedProductIds.includes(productId) ||
    Object.hasOwn(preferences.products, productId) ||
    Object.hasOwn(preferences.preferredCoverImage, productId) ||
    Object.hasOwn(preferences.manualNote, productId)
  )
}

export function migrateCatalogItemPreferences({ preferences, prototypes, preferenceMap }) {
  const before = structuredClone(preferences || EMPTY_PREFERENCES)
  const normalized = migratePrototypePreferences({
    preferences: before,
    aliases: {},
    prototypes,
  })
  const next = normalized.preferences
  const prototypeByCatalogItemId = new Map()
  for (const prototype of prototypes || []) {
    for (const catalogItemId of prototype.catalogItemIds || []) {
      if (prototypeByCatalogItemId.has(catalogItemId)) {
        throw new Error(`Catalog Item belongs to multiple Prototypes: ${catalogItemId}.`)
      }
      prototypeByCatalogItemId.set(catalogItemId, prototype)
    }
  }
  const groups = new Map()
  const summary = {
    catalogMappings: 0,
    cover: 0,
    exclude: 0,
    notes: 0,
    conflicts: [],
    invalidCoverPreferences: 0,
    unresolvedMappings: 0,
  }
  for (const mapping of normalizeCatalogPreferenceMappings(preferenceMap)) {
    const targets = [...new Set(mapping.catalogItemIds
      .map((catalogItemId) => prototypeByCatalogItemId.get(catalogItemId)?.prototypeId)
      .filter(Boolean))]
    if (targets.length !== 1) {
      summary.unresolvedMappings += 1
      summary.conflicts.push({
        kind: 'catalog_mapping',
        legacyProductId: mapping.legacyProductId,
        catalogItemIds: mapping.catalogItemIds,
        targetPrototypeIds: targets,
      })
      continue
    }
    const values = groups.get(targets[0]) || []
    values.push(mapping)
    groups.set(targets[0], values.sort((left, right) => (
      left.legacyProductId.localeCompare(right.legacyProductId)
    )))
  }

  const excluded = new Set(next.excludedProductIds)
  const prototypeById = new Map((prototypes || []).map((value) => [value.prototypeId, value]))
  for (const [prototypeId, mappings] of [...groups.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    const prototype = prototypeById.get(prototypeId)
    const activeMappings = mappings.filter((mapping) => (
      preferenceFootprint(next, mapping.legacyProductId)
    ))
    if (!activeMappings.length) continue
    summary.catalogMappings += activeMappings.length
    const targetEntry = next.products[prototypeId] && typeof next.products[prototypeId] === 'object'
      ? next.products[prototypeId]
      : {}
    next.products[prototypeId] = targetEntry

    const targetCover = coverValue(targetEntry, next.preferredCoverImage[prototypeId])
    const coverCandidates = activeMappings.map((mapping) => {
      const legacyEntry = next.products[mapping.legacyProductId] || {}
      const raw = coverValue(legacyEntry, next.preferredCoverImage[mapping.legacyProductId])
      const mapped = mapping.imageUrlBySha256[raw] || raw
      return {
        legacyProductId: mapping.legacyProductId,
        raw,
        valid: validCover(mapped, prototype),
      }
    }).filter((value) => value.raw)
    const validTargetCover = validCover(targetCover, prototype)
    const validMappedCovers = coverCandidates.filter((value) => value.valid)
    summary.invalidCoverPreferences += coverCandidates.length - validMappedCovers.length
    const selectedCover = validTargetCover || validMappedCovers[0]?.valid || null
    setCover(targetEntry, selectedCover)
    if (!validTargetCover && selectedCover) summary.cover += 1
    const distinctCovers = uniqueStrings([
      validTargetCover?.value,
      ...validMappedCovers.map((value) => value.valid.value),
    ])
    if (distinctCovers.length > 1) {
      summary.conflicts.push({
        kind: 'cover',
        survivorPrototypeId: prototypeId,
        chosen: selectedCover.value,
        candidates: validMappedCovers.map((value) => ({
          legacyProductId: value.legacyProductId,
          value: value.valid.value,
        })),
      })
    }

    const legacyIds = mappings.map((mapping) => mapping.legacyProductId)
    const excludedLegacyIds = legacyIds.filter((productId) => excluded.has(productId))
    const previousExcluded = excluded.has(prototypeId)
    if (excludedLegacyIds.length === legacyIds.length) excluded.add(prototypeId)
    else if (!previousExcluded) excluded.delete(prototypeId)
    if (previousExcluded !== excluded.has(prototypeId)) summary.exclude += 1
    if (excludedLegacyIds.length > 0 && excludedLegacyIds.length < legacyIds.length) {
      summary.conflicts.push({
        kind: 'exclude',
        survivorPrototypeId: prototypeId,
        resolution: 'visible',
        excludedLegacyProductIds: excludedLegacyIds,
      })
    }

    const previousNote = String(targetEntry.manualNote || next.manualNote[prototypeId] || '').trim()
    const notes = [
      { prototypeId, note: previousNote },
      ...activeMappings.map((mapping) => ({
        prototypeId: mapping.legacyProductId,
        note: String(
          next.products[mapping.legacyProductId]?.manualNote ||
          next.manualNote[mapping.legacyProductId] ||
          '',
        ).trim(),
      })),
    ]
    const mergedNote = mergePrototypeNotes(notes)
    if (mergedNote) targetEntry.manualNote = mergedNote
    else delete targetEntry.manualNote
    if (mergedNote && mergedNote !== previousNote && notes.some((value) => (
      value.prototypeId !== prototypeId && value.note
    ))) summary.notes += 1

    for (const legacyProductId of legacyIds) {
      excluded.delete(legacyProductId)
      delete next.products[legacyProductId]
      delete next.preferredCoverImage[legacyProductId]
      delete next.manualNote[legacyProductId]
    }
    if (Object.keys(targetEntry).length === 0) delete next.products[prototypeId]
  }

  next.excludedProductIds = [...excluded].sort()
  next.preferredCoverImage = Object.fromEntries(Object.entries(next.products)
    .map(([prototypeId, entry]) => [prototypeId, coverValue(entry)])
    .filter(([, value]) => value))
  next.manualNote = Object.fromEntries(Object.entries(next.products)
    .map(([prototypeId, entry]) => [prototypeId, String(entry.manualNote || '').trim()])
    .filter(([, value]) => value))

  return {
    preferences: next,
    changed: JSON.stringify(before) !== JSON.stringify(next),
    summary: { ...summary, conflictCount: summary.conflicts.length },
  }
}

export async function backupPreferencesOnce(
  preferencesPath,
  backupLabel = 'rem-v1-consolidation',
) {
  if (!/^[a-z0-9-]+$/u.test(backupLabel)) throw new Error('Preference backup label is invalid.')
  const backupPath = `${preferencesPath}.pre-${backupLabel}.bak`
  try {
    await copyFile(preferencesPath, backupPath, fsConstants.COPYFILE_EXCL)
    return { created: true, backupPath }
  } catch (error) {
    if (error?.code === 'EEXIST') return { created: false, backupPath }
    if (error?.code === 'ENOENT') return { created: false, backupPath: null }
    throw error
  }
}

export async function migratePrototypePreferencesFile({
  preferencesPath,
  aliases,
  prototypes,
  catalogPreferenceMap = null,
  backupLabel = 'rem-v1-consolidation',
}) {
  const current = await readJson(preferencesPath)
  if (!current) {
    return {
      changed: false,
      preferences: null,
      summary: { cover: 0, exclude: 0, notes: 0, conflicts: [], conflictCount: 0, invalidCoverPreferences: 0 },
      backup: { created: false, backupPath: null },
    }
  }
  const aliasMigration = migratePrototypePreferences({ preferences: current, aliases, prototypes })
  const migration = catalogPreferenceMap
    ? migrateCatalogItemPreferences({
      preferences: aliasMigration.preferences,
      prototypes,
      preferenceMap: catalogPreferenceMap,
    })
    : aliasMigration
  if (catalogPreferenceMap) {
    migration.summary.aliasMigration = aliasMigration.summary
  }
  migration.changed = JSON.stringify(current) !== JSON.stringify(migration.preferences)
  let backup = { created: false, backupPath: null }
  if (migration.changed) {
    backup = await backupPreferencesOnce(preferencesPath, backupLabel)
    await atomicWriteJson(preferencesPath, migration.preferences)
  }
  return { ...migration, backup }
}
