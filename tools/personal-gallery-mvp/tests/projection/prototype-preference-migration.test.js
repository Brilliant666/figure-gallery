import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  backupPreferencesOnce,
  mergePrototypeNotes,
  migratePrototypePreferences,
  migratePrototypePreferencesFile,
} from '../../src/projection/prototype-preference-migration.js'

const survivor = 'rem-proto-1111111111111111'
const retiredA = 'rem-proto-2222222222222222'
const retiredB = 'rem-proto-3333333333333333'
const unrelated = 'rem-proto-9999999999999999'
const imageA = 'https://www.goodsmile.com/example/a.jpg'
const imageB = 'https://www.goodsmile.com/example/b.jpg'

function prototype() {
  return {
    prototypeId: survivor,
    images: [
      { id: 'image-ref-a', url: imageA },
      { id: 'image-ref-b', url: imageB },
    ],
  }
}

function preferences(overrides = {}) {
  return {
    schemaVersion: 2,
    excludedProductIds: [],
    excludedImageSha256: [],
    products: {},
    preferredCoverImage: {},
    manualNote: {},
    ...overrides,
  }
}

test('cover, mixed exclusion, and distinct notes migrate conservatively and idempotently', () => {
  const initial = preferences({
    excludedProductIds: [retiredA],
    products: {
      [retiredA]: { preferredCoverImageUrl: imageA, manualNote: 'front view' },
      [retiredB]: { preferredCoverImageUrl: imageB, manualNote: 'side view' },
    },
    preferredCoverImage: { [retiredA]: imageA, [retiredB]: imageB, [unrelated]: imageA },
    manualNote: { [retiredA]: 'front view', [retiredB]: 'side view', [unrelated]: 'unrelated note' },
  })
  const aliases = { [retiredA]: survivor, [retiredB]: survivor }
  const first = migratePrototypePreferences({ preferences: initial, aliases, prototypes: [prototype()] })
  const second = migratePrototypePreferences({
    preferences: first.preferences,
    aliases,
    prototypes: [prototype()],
  })

  assert.equal(first.preferences.products[survivor].preferredCoverImageUrl, imageA)
  assert.equal(first.changed, true)
  assert.equal(first.preferences.excludedProductIds.includes(survivor), false)
  assert.equal(
    first.preferences.products[survivor].manualNote,
    `[${retiredA}] front view\n[${retiredB}] side view`,
  )
  assert.equal(first.summary.cover, 1)
  assert.equal(first.summary.exclude, 0)
  assert.equal(first.summary.notes, 1)
  assert.deepEqual(first.summary.conflicts.map((value) => value.kind).sort(), ['cover', 'exclude'])
  assert.equal(first.preferences.excludedProductIds.includes(retiredA), false)
  assert.equal(Object.hasOwn(first.preferences.products, retiredA), false)
  assert.equal(Object.hasOwn(first.preferences.products, retiredB), false)
  assert.equal(Object.hasOwn(first.preferences.preferredCoverImage, retiredA), false)
  assert.equal(Object.hasOwn(first.preferences.preferredCoverImage, retiredB), false)
  assert.equal(Object.hasOwn(first.preferences.manualNote, retiredA), false)
  assert.equal(Object.hasOwn(first.preferences.manualNote, retiredB), false)
  assert.deepEqual(first.preferences.products[unrelated], {
    preferredCoverImageUrl: imageA,
    manualNote: 'unrelated note',
  })
  assert.equal(first.preferences.preferredCoverImage[unrelated], imageA)
  assert.equal(first.preferences.manualNote[unrelated], 'unrelated note')
  assert.equal(second.changed, false)
  assert.deepEqual(second.preferences, first.preferences)
})

test('note merger deduplicates the same text across sources and labels each distinct note once', () => {
  assert.equal(mergePrototypeNotes([
    { prototypeId: retiredB, note: 'same note' },
    { prototypeId: retiredA, note: 'same note' },
    { prototypeId: survivor, note: 'same note' },
  ]), 'same note')
  assert.equal(mergePrototypeNotes([
    { prototypeId: retiredB, note: 'second note' },
    { prototypeId: retiredA, note: 'first note' },
    { prototypeId: survivor, note: 'first note' },
  ]), `[${survivor}, ${retiredA}] first note\n[${retiredB}] second note`)
})

test('cover-only migration creates a backup and atomically writes the migrated preferences', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rem-pref-writeback-'))
  const target = path.join(root, 'preferences.json')
  const initial = preferences({
    products: { [retiredA]: { preferredCoverImageUrl: imageA } },
    preferredCoverImage: { [retiredA]: imageA },
  })
  try {
    await writeFile(target, `${JSON.stringify(initial, null, 2)}\n`, 'utf8')
    const first = await migratePrototypePreferencesFile({
      preferencesPath: target,
      aliases: { [retiredA]: survivor },
      prototypes: [prototype()],
    })
    const written = JSON.parse(await readFile(target, 'utf8'))
    const backup = JSON.parse(await readFile(first.backup.backupPath, 'utf8'))
    const second = await migratePrototypePreferencesFile({
      preferencesPath: target,
      aliases: { [retiredA]: survivor },
      prototypes: [prototype()],
    })

    assert.equal(first.changed, true)
    assert.equal(first.backup.created, true)
    assert.deepEqual(backup, initial)
    assert.equal(written.products[survivor].preferredCoverImageUrl, imageA)
    assert.equal(Object.hasOwn(written.products, retiredA), false)
    assert.equal(Object.hasOwn(written.preferredCoverImage, retiredA), false)
    assert.equal(second.changed, false)
    assert.equal(second.backup.created, false)
    assert.deepEqual(second.preferences, written)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('survivor cover wins and all-excluded aliases keep the survivor excluded', () => {
  const initial = preferences({
    excludedProductIds: [survivor, retiredA, retiredB],
    products: {
      [survivor]: { preferredCoverImageUrl: imageB },
      [retiredA]: { preferredCoverImageUrl: imageA },
    },
    preferredCoverImage: { [survivor]: imageB, [retiredA]: imageA },
  })
  const result = migratePrototypePreferences({
    preferences: initial,
    aliases: { [retiredA]: survivor, [retiredB]: survivor },
    prototypes: [prototype()],
  })
  const repeated = migratePrototypePreferences({
    preferences: result.preferences,
    aliases: { [retiredA]: survivor, [retiredB]: survivor },
    prototypes: [prototype()],
  })

  assert.equal(result.preferences.products[survivor].preferredCoverImageUrl, imageB)
  assert.equal(result.preferences.excludedProductIds.includes(survivor), true)
  assert.equal(result.preferences.excludedProductIds.includes(retiredA), false)
  assert.equal(result.preferences.excludedProductIds.includes(retiredB), false)
  assert.equal(Object.hasOwn(result.preferences.products, retiredA), false)
  assert.equal(Object.hasOwn(result.preferences.preferredCoverImage, retiredA), false)
  assert.equal(result.summary.cover, 0)
  assert.equal(result.summary.exclude, 0)
  assert.equal(repeated.changed, false)
  assert.deepEqual(repeated.preferences, result.preferences)
})

test('preference backup is created once and never overwritten', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rem-pref-backup-'))
  const target = path.join(root, 'preferences.json')
  try {
    await writeFile(target, '{"original":true}\n', 'utf8')
    const first = await backupPreferencesOnce(target)
    await writeFile(target, '{"original":false}\n', 'utf8')
    const second = await backupPreferencesOnce(target)

    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(await readFile(first.backupPath, 'utf8'), '{"original":true}\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
