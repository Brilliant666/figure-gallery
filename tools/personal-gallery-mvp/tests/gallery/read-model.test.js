import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  loadGalleryByQuery,
  loadRunGallery,
  listRecentRuns,
  normalizePreferences,
  normalizeQuery,
  resolveMediaObject,
  savePreferences,
} from '../../src/gallery/read-model.js'
import { HPOI_FROZEN_STATUS } from '../../src/storage/source-status.js'

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

test('projects official-source fields and resolves the stable Cheshire gallery to the latest usable run', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-official-read-model-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const successfulRunId = '20260718T010000Z-official-cheshire'
  const failedRunId = '20260718T020000Z-official-cheshire-failed'
  const successfulDirectory = path.join(root, 'runs', successfulRunId)
  const failedDirectory = path.join(root, 'runs', failedRunId)
  await mkdir(successfulDirectory, { recursive: true })
  await mkdir(failedDirectory, { recursive: true })
  await writeFile(
    path.join(successfulDirectory, 'run.json'),
    JSON.stringify({
      runId: successfulRunId,
      query: '柴郡',
      characterSlug: 'cheshire',
      sourceMode: 'official_sources',
      status: 'completed',
      startedAt: '2026-07-18T01:00:00Z',
      completedAt: '2026-07-18T01:00:10Z',
      sourceStatus: {
        hpoi: {
          hpoiLiveStatus: 'blocked_by_source',
          stopReason: 'captcha',
          retryAllowed: false,
          blockedAt: '2026-07-17T18:12:58Z',
          consecutiveBlockedRuns: 3,
        },
      },
    }),
  )
  await writeFile(
    path.join(successfulDirectory, 'products.json'),
    JSON.stringify([
      {
        productKey: 'official-goodsmile-com-id-cheshire-001',
        fieldDigest: 'b'.repeat(64),
        lastSeenAt: '2026-07-18T01:00:08Z',
        fields: {
          sourceKind: 'official_manufacturer',
          sourceDomain: 'www.goodsmile.com',
          discoveryQuery: '"Azur Lane" Cheshire figure',
          discoveryMethod: 'firecrawl_search',
          officialProductId: 'cheshire-001',
          title: 'Cheshire: Summery Date!',
          character: 'Cheshire',
          series: 'Azur Lane',
          manufacturer: 'Good Smile Arts Shanghai',
          distributor: 'Good Smile Company',
          classification: 'likely_scale',
          category: 'scale figure',
          scale: '1/7',
          height: '260 mm',
          releaseDate: '2026-08',
          price: '¥24,800',
          sculptor: 'Synthetic Sculptor',
          paintwork: 'Synthetic Paintwork',
          description: 'Synthetic official-style fixture content.',
          sourceUrl: 'https://www.goodsmile.com/en/product/cheshire-001',
          parserVersion: 'official-product-v1',
        },
        imageSha256: [SHA],
      },
    ]),
  )
  await writeFile(path.join(successfulDirectory, 'failures.json'), '[]')
  await writeFile(
    path.join(failedDirectory, 'run.json'),
    JSON.stringify({
      runId: failedRunId,
      query: '柴郡',
      characterSlug: 'cheshire',
      sourceMode: 'official_sources',
      status: 'failed',
      stopReason: 'synthetic failure',
    }),
  )
  await writeFile(path.join(failedDirectory, 'products.json'), '[]')
  await writeFile(path.join(failedDirectory, 'failures.json'), JSON.stringify([{ reason: 'synthetic failure' }]))
  await writeFile(
    path.join(root, 'image-index.json'),
    JSON.stringify({ objects: { [SHA]: { sha256: SHA, mime: 'image/png', width: 240, height: 360 } } }),
  )

  const gallery = await loadGalleryByQuery(root, 'cheshire')
  assert.equal(gallery.runId, successfulRunId)
  assert.equal(gallery.characterSlug, 'cheshire')
  assert.equal(gallery.sourceMode, 'official_sources')
  assert.deepEqual(gallery.sourceStatus.hpoi, HPOI_FROZEN_STATUS)
  assert.equal(gallery.summary.officialProducts, 1)
  assert.equal(gallery.summary.officialImages, 1)
  assert.equal(gallery.products[0].sourceKind, 'official_manufacturer')
  assert.equal(gallery.products[0].sourceDomain, 'www.goodsmile.com')
  assert.equal(gallery.products[0].discoveryMethod, 'firecrawl_search')
  assert.equal(gallery.products[0].officialProductId, 'cheshire-001')
  assert.equal(gallery.products[0].series, 'Azur Lane')
  assert.equal(gallery.products[0].releaseDate, '2026-08')
  assert.equal(gallery.products[0].fieldDigest, 'b'.repeat(64))
  assert.equal(gallery.products[0].lastSeenAt, '2026-07-18T01:00:08Z')

  const recent = await listRecentRuns(root, 2)
  assert.equal(recent[0].characterSlug, 'cheshire')
  assert.equal(recent[0].sourceMode, 'official_sources')
})
