import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  loadGalleryByQuery,
  loadRunGallery,
  normalizePreferences,
  normalizeQuery,
  resolveMediaObject,
  savePreferences,
} from '../../src/gallery/read-model.js'

const SHA = 'a'.repeat(64)

test('normalizes local gallery manifests and preserves exclusions', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-read-model-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runId = '20260716T010203Z-柴郡'
  const runDirectory = path.join(root, 'runs', runId)
  const objectDirectory = path.join(root, 'objects', 'sha256', 'aa')
  await mkdir(runDirectory, { recursive: true })
  await mkdir(objectDirectory, { recursive: true })
  await writeFile(
    path.join(runDirectory, 'run.json'),
    JSON.stringify({ query: '柴郡', status: 'completed', startedAt: '2026-07-16T01:02:03Z' }),
  )
  await writeFile(
    path.join(runDirectory, 'products.json'),
    JSON.stringify([
      {
        id: 'synthetic-990001',
        title: 'Synthetic Cheshire Figure',
        manufacturer: 'Synthetic Maker',
        classification: 'likely_scale',
        scale: '1/7',
        sourceUrl: 'https://www.hpoi.net/hobby/990001',
        images: [{ sha256: SHA, width: 2, height: 3, mime: 'image/png' }],
      },
    ]),
  )
  await writeFile(path.join(runDirectory, 'failures.json'), JSON.stringify([{ reason: 'synthetic failure' }]))
  await writeFile(path.join(objectDirectory, `${SHA}.png`), Buffer.from('synthetic'))
  await savePreferences(root, {
    excludedProductIds: ['synthetic-990001'],
    excludedImageSha256: [SHA],
    preferredCoverImage: { 'synthetic-990001': SHA },
    manualNote: { 'synthetic-990001': 'keep for comparison' },
  })

  const gallery = await loadRunGallery(root, runId)
  assert.equal(gallery.query, '柴郡')
  assert.equal(gallery.summary.products, 1)
  assert.equal(gallery.summary.images, 1)
  assert.equal(gallery.products[0].excluded, true)
  assert.equal(gallery.products[0].images[0].excluded, true)
  assert.equal((await loadGalleryByQuery(root, '柴郡')).runId, runId)
  assert.equal(await resolveMediaObject(root, SHA), path.join(objectDirectory, `${SHA}.png`))
})

test('query and preference normalization reject unsafe values', () => {
  assert.equal(normalizeQuery(' 柴 郡 / Azur '), '柴-郡-azur')
  assert.deepEqual(normalizePreferences({ excludedProductIds: ['one', 'one', 2] }).excludedProductIds, ['one'])
  assert.deepEqual(normalizePreferences({ excludedImageSha256: ['bad'] }).excludedImageSha256, [])
})

test('resolves GalleryStore product summaries, product fields, and image index objects', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-store-shape-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runId = '2026-07-16T02-00-00Z-synthetic'
  const runDirectory = path.join(root, 'runs', runId)
  await mkdir(runDirectory, { recursive: true })
  await mkdir(path.join(root, 'products'), { recursive: true })
  await writeFile(path.join(runDirectory, 'run.json'), JSON.stringify({ query: '柴郡', status: 'completed' }))
  await writeFile(
    path.join(runDirectory, 'products.json'),
    JSON.stringify([{ productKey: 'hpoi-id-synthetic-990002', state: 'new' }]),
  )
  await writeFile(path.join(runDirectory, 'failures.json'), '[]')
  await writeFile(
    path.join(root, 'products', 'hpoi-id-synthetic-990002.json'),
    JSON.stringify({
      productKey: 'hpoi-id-synthetic-990002',
      fields: {
        title: 'Synthetic stored product',
        manufacturer: 'Synthetic Maker',
        classification: 'likely_prize',
        rawCategory: 'prize',
        rawScale: 'non-scale',
        sourceUrl: 'https://www.hpoi.net/hobby/990002',
      },
      imageSha256: [SHA],
    }),
  )
  await writeFile(
    path.join(root, 'image-index.json'),
    JSON.stringify({
      objects: {
        [SHA]: { sha256: SHA, extension: 'png', mime: 'image/png', width: 240, height: 360 },
      },
    }),
  )

  const gallery = await loadRunGallery(root, runId)
  assert.equal(gallery.products.length, 1)
  assert.equal(gallery.products[0].id, 'hpoi-id-synthetic-990002')
  assert.equal(gallery.products[0].title, 'Synthetic stored product')
  assert.equal(gallery.products[0].classification, 'likely_prize')
  assert.equal(gallery.products[0].images[0].sha256, SHA)
})

test('prefers immutable per-run product snapshots so historical galleries do not drift', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-run-snapshot-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runId = 'synthetic-historical-run'
  const productKey = 'hpoi-id-synthetic-990003'
  const runDirectory = path.join(root, 'runs', runId)
  await mkdir(runDirectory, { recursive: true })
  await mkdir(path.join(root, 'products'), { recursive: true })
  await writeFile(path.join(runDirectory, 'run.json'), JSON.stringify({ query: '柴郡', status: 'completed' }))
  await writeFile(path.join(runDirectory, 'failures.json'), '[]')
  await writeFile(
    path.join(runDirectory, 'products.json'),
    JSON.stringify([
      {
        productKey,
        state: 'new',
        fields: {
          title: 'Historical synthetic title',
          manufacturer: 'Historical synthetic maker',
          classification: 'unknown',
        },
        imageSha256: [SHA],
      },
    ]),
  )
  await writeFile(
    path.join(root, 'products', `${productKey}.json`),
    JSON.stringify({
      productKey,
      fields: {
        title: 'Later changed synthetic title',
        manufacturer: 'Later synthetic maker',
        classification: 'likely_scale',
      },
      imageSha256: [],
    }),
  )
  await writeFile(
    path.join(root, 'image-index.json'),
    JSON.stringify({ objects: { [SHA]: { sha256: SHA, mime: 'image/png', width: 1, height: 1 } } }),
  )

  const gallery = await loadRunGallery(root, runId)
  assert.equal(gallery.products[0].title, 'Historical synthetic title')
  assert.equal(gallery.products[0].classification, 'unknown')
  assert.equal(gallery.products[0].images[0].sha256, SHA)
})
