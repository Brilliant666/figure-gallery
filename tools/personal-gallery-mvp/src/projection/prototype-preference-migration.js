import { constants as fsConstants } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

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

export function mergePrototypeNotes(values = []) {
  const notes = values
    .map(({ prototypeId, note }) => ({
      prototypeId: String(prototypeId || '').trim(),
      note: String(note || '').trim(),
    }))
    .filter(({ prototypeId, note }) => prototypeId && note)
    .sort((left, right) => left.prototypeId.localeCompare(right.prototypeId))
  const sourcesByNote = new Map()
  for (const { prototypeId, note } of notes) {
    const sources = sourcesByNote.get(note) || []
    if (!sources.includes(prototypeId)) sources.push(prototypeId)
    sourcesByNote.set(note, sources)
  }
  if (sourcesByNote.size === 0) return ''
  if (sourcesByNote.size === 1) return sourcesByNote.keys().next().value
  return [...sourcesByNote.entries()]
    .map(([note, prototypeIds]) => ({ note, prototypeIds: [...prototypeIds].sort() }))
    .sort((left, right) => left.prototypeIds[0].localeCompare(right.prototypeIds[0]))
    .map(({ note, prototypeIds }) => `[${prototypeIds.join(', ')}] ${note}`)
    .join('\n')
}

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

export async function backupPreferencesOnce(preferencesPath) {
  const backupPath = `${preferencesPath}.pre-rem-v1-consolidation.bak`
  try {
    await copyFile(preferencesPath, backupPath, fsConstants.COPYFILE_EXCL)
    return { created: true, backupPath }
  } catch (error) {
    if (error?.code === 'EEXIST') return { created: false, backupPath }
    if (error?.code === 'ENOENT') return { created: false, backupPath: null }
    throw error
  }
}

export async function migratePrototypePreferencesFile({ preferencesPath, aliases, prototypes }) {
  const current = await readJson(preferencesPath)
  if (!current) {
    return {
      changed: false,
      preferences: null,
      summary: { cover: 0, exclude: 0, notes: 0, conflicts: [], conflictCount: 0, invalidCoverPreferences: 0 },
      backup: { created: false, backupPath: null },
    }
  }
  const migration = migratePrototypePreferences({ preferences: current, aliases, prototypes })
  let backup = { created: false, backupPath: null }
  if (migration.changed) {
    backup = await backupPreferencesOnce(preferencesPath)
    await atomicWriteJson(preferencesPath, migration.preferences)
  }
  return { ...migration, backup }
}
