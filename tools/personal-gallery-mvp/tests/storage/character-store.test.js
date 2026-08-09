import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveBuiltinCharacter } from '../../src/characters/registry.js'
import { GalleryStore } from '../../src/storage/gallery-store.js'
import {
  characterPreferencesPath,
  createLocalCharacterConfig,
  ensureCharacterStorage,
  listCharacterConfigs,
  listCharacterRunIds,
  resolveCharacterConfig,
} from '../../src/storage/character-store.js'
import { productIdentity } from '../../src/storage/identity.js'

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-characters-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function product(character, id, title = 'Synthetic Shared Title') {
  return {
    characterId: character.characterId,
    characterSlug: character.slug,
    sourceKind: 'official_manufacturer',
    sourceDomain: 'goodsmile.com',
    officialProductId: id,
    sourceUrl: `https://www.goodsmile.com/en/product/${id}/synthetic`,
    title,
  }
}

test('product identity includes character context even when source domain and source ID are identical', () => {
  const cheshire = resolveBuiltinCharacter('柴郡')
  const rem = resolveBuiltinCharacter('蕾姆')
  const left = productIdentity(product(cheshire, 'SHARED-001'))
  const right = productIdentity(product(rem, 'SHARED-001'))
  assert.notEqual(left.key, right.key)
  assert.match(left.key, /^azur-lane_cheshire_official_manufacturer_goodsmile\.com-id-SHARED-001$/u)
  assert.match(right.key, /^rezero_rem_official_manufacturer_goodsmile\.com-id-SHARED-001$/u)
})

test('character runs and preferences are isolated while the SHA-256 object index is safely shared', async (t) => {
  const root = await temporaryRoot(t)
  const cheshire = resolveBuiltinCharacter('柴郡')
  const rem = resolveBuiltinCharacter('蕾姆')
  const cheshireStore = await new GalleryStore(root, { characterConfig: cheshire }).initialize()
  const remStore = await new GalleryStore(root, { characterConfig: rem }).initialize()
  const cheshireRun = await cheshireStore.createRun({ query: '柴郡', characterConfig: cheshire, requestedRunId: 'character-a-run' })
  const remRun = await remStore.createRun({ query: '蕾姆', characterConfig: rem, requestedRunId: 'character-b-run' })
  const cheshireProduct = await cheshireStore.upsertProduct(cheshireRun.runId, product(cheshire, 'SHARED-001'))
  const remProduct = await remStore.upsertProduct(remRun.runId, product(rem, 'SHARED-001'))
  const sha256 = 'a'.repeat(64)
  const image = {
    sha256,
    extension: 'png',
    mime: 'image/png',
    bytes: 100,
    width: 10,
    height: 20,
    path: cheshireStore.objectPath(sha256, 'png'),
  }
  await cheshireStore.registerImage({
    runId: cheshireRun.runId,
    productKey: cheshireProduct.productKey,
    url: 'https://images.goodsmile.com/synthetic/shared-a.png',
    sourceProductUrl: product(cheshire, 'SHARED-001').sourceUrl,
    image,
  })
  await remStore.registerImage({
    runId: remRun.runId,
    productKey: remProduct.productKey,
    url: 'https://images.goodsmile.com/synthetic/shared-b.png',
    sourceProductUrl: product(rem, 'SHARED-001').sourceUrl,
    image,
  })
  await cheshireStore.setPreferredCover(cheshireProduct.productKey, sha256)
  await remStore.excludeImage(sha256)

  assert.deepEqual(await listCharacterRunIds(root, cheshire), ['character-a-run'])
  assert.deepEqual(await listCharacterRunIds(root, rem), ['character-b-run'])
  const cheshirePreferences = JSON.parse(await readFile(characterPreferencesPath(root, 'cheshire'), 'utf8'))
  const remPreferences = JSON.parse(await readFile(characterPreferencesPath(root, 'rem'), 'utf8'))
  assert.equal(cheshirePreferences.preferredCoverImage[cheshireProduct.productKey], sha256)
  assert.deepEqual(cheshirePreferences.excludedImageSha256, [])
  assert.deepEqual(remPreferences.preferredCoverImage, {})
  assert.deepEqual(remPreferences.excludedImageSha256, [sha256])
  const imageIndex = await cheshireStore.readImageIndex()
  assert.equal(Object.keys(imageIndex.objects).length, 1)
  assert.deepEqual(imageIndex.objects[sha256].productKeys.sort(), [cheshireProduct.productKey, remProduct.productKey].sort())
})

test('legacy root preferences migrate only to the matching legacy character and migration is idempotent', async (t) => {
  const root = await temporaryRoot(t)
  const cheshire = resolveBuiltinCharacter('柴郡')
  const rem = resolveBuiltinCharacter('蕾姆')
  await mkdir(path.join(root, 'runs', 'legacy-cheshire'), { recursive: true })
  await writeFile(path.join(root, 'runs', 'legacy-cheshire', 'run.json'), JSON.stringify({
    runId: 'legacy-cheshire',
    query: '柴郡',
    characterSlug: 'cheshire',
  }))
  await writeFile(path.join(root, 'runs', 'legacy-cheshire', 'products.json'), '[]')
  await writeFile(path.join(root, 'preferences.json'), JSON.stringify({
    schemaVersion: 1,
    excludedProductIds: ['legacy-product'],
    excludedImageSha256: [],
    preferredCoverImage: { 'legacy-product': 'b'.repeat(64) },
    manualNote: { 'legacy-product': 'keep me' },
  }))
  await ensureCharacterStorage(root, cheshire)
  await ensureCharacterStorage(root, cheshire)
  await ensureCharacterStorage(root, rem)
  const cheshirePreferences = JSON.parse(await readFile(characterPreferencesPath(root, 'cheshire'), 'utf8'))
  const remPreferences = JSON.parse(await readFile(characterPreferencesPath(root, 'rem'), 'utf8'))
  assert.deepEqual(cheshirePreferences.excludedProductIds, ['legacy-product'])
  assert.equal(cheshirePreferences.manualNote['legacy-product'], 'keep me')
  assert.deepEqual(remPreferences.excludedProductIds, [])
  assert.deepEqual(remPreferences.preferredCoverImage, {})
})

test('stale built-in runtime snapshots cannot hide newly reviewed built-in seeds or safety aliases', async (t) => {
  const root = await temporaryRoot(t)
  const rem = resolveBuiltinCharacter('蕾姆')
  const directory = path.join(root, 'characters', 'rem')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'config.json'), JSON.stringify({
    ...rem,
    reviewedSeeds: [],
    conflictingAliases: [],
  }))
  const loaded = (await listCharacterConfigs(root)).find((character) => character.characterId === rem.characterId)
  assert.equal(loaded.reviewedSeeds.length, rem.reviewedSeeds.length)
  assert.deepEqual(loaded.conflictingAliases, rem.conflictingAliases)
  await ensureCharacterStorage(root, loaded)
  const refreshed = JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8'))
  assert.equal(refreshed.reviewedSeeds.length, rem.reviewedSeeds.length)
  assert.deepEqual(refreshed.conflictingAliases, [...rem.conflictingAliases])
})

test('a user-confirmed local character resolves by slug and alias without becoming a builtin', async (t) => {
  const root = await temporaryRoot(t)
  const created = await createLocalCharacterConfig(root, {
    characterId: 'local:synthetic-character',
    slug: 'synthetic-character',
    displayName: 'Synthetic Character',
    aliases: ['Synthetic Character', 'Synthetic Alias'],
    workNames: ['Synthetic Work'],
  })
  assert.equal(created.reviewedSeeds.length, 0)
  assert.equal((await resolveCharacterConfig(root, 'synthetic-character')).characterId, created.characterId)
  assert.equal((await resolveCharacterConfig(root, 'Synthetic Alias')).characterId, created.characterId)
  assert.ok((await listCharacterConfigs(root)).some((character) => character.characterId === created.characterId))
  await assert.rejects(
    createLocalCharacterConfig(root, {
      characterId: 'local:conflict',
      slug: 'conflict',
      displayName: 'Conflict',
      aliases: ['Synthetic Alias'],
      workNames: ['Other Work'],
    }),
    /conflicts with/u,
  )
})
