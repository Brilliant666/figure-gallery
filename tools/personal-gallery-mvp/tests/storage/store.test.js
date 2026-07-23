import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { GalleryStore } from '../../src/storage/gallery-store.js'
import { normalizeCanonicalUrl, productIdentity } from '../../src/storage/identity.js'
import { loadRunGallery } from '../../src/gallery/read-model.js'

async function temporaryStore(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let sequence = 0
  const store = new GalleryStore(root, {
    clock: () => new Date(`2026-07-16T00:00:0${sequence++}.000Z`),
    idFactory: () => `test-${sequence}`,
  })
  await store.initialize()
  return { root, store }
}

test('product identity prefers a stable source ID and normalizes URL only as fallback', () => {
  assert.deepEqual(productIdentity({ sourceType: 'hpoi', sourceItemId: '80002', sourceUrl: 'https://www.hpoi.net/hobby/other' }), {
    key: 'hpoi-id-80002',
    kind: 'source_id',
    sourceItemId: '80002',
    sourceType: 'hpoi',
  })
  const normalized = normalizeCanonicalUrl('HTTPS://WWW.HPOI.NET:443/hobby//80002/?utm_source=test&b=2&a=1#gallery')
  assert.equal(normalized, 'https://www.hpoi.net/hobby/80002?a=1&b=2')
  const fallback = productIdentity({ sourceType: 'hpoi', sourceUrl: 'https://www.hpoi.net/hobby/80002?utm_source=test' })
  assert.equal(fallback.kind, 'normalized_url')
  assert.match(fallback.key, /^hpoi-url-[a-f0-9]{64}$/)
})

test('official product identity is namespaced by canonical source domain', () => {
  const goodSmile = productIdentity({
    sourceKind: 'official_manufacturer',
    sourceDomain: 'www.goodsmile.com',
    officialProductId: 'CHESHIRE-001',
    sourceUrl: 'https://www.goodsmile.com/en/product/cheshire-001',
  })
  const alter = productIdentity({
    sourceKind: 'official_manufacturer',
    sourceDomain: 'alter-web.jp',
    officialProductId: 'CHESHIRE-001',
    sourceUrl: 'https://alter-web.jp/products/cheshire-001',
  })
  assert.equal(goodSmile.kind, 'source_id')
  assert.match(goodSmile.key, /^official_manufacturer_goodsmile\.com-id-CHESHIRE-001$/)
  assert.notEqual(goodSmile.key, alter.key)

  const fallback = productIdentity({
    sourceKind: 'official_manufacturer',
    sourceDomain: 'goodsmile.com',
    sourceUrl: 'https://goodsmile.com/en/product/cheshire?utm_source=search',
  })
  assert.equal(fallback.kind, 'normalized_url')
  assert.match(fallback.key, /^official_manufacturer_goodsmile\.com-url-[a-f0-9]{64}$/)
})

test('official discovery provenance and observation timestamps do not create false changes', async (t) => {
  const { store } = await temporaryStore(t)
  const base = {
    sourceKind: 'official_manufacturer',
    sourceDomain: 'goodsmile.com',
    officialProductId: 'GSC-CHESHIRE-1',
    sourceUrl: 'https://goodsmile.com/en/product/cheshire',
    title: 'Cheshire: Synthetic Outfit',
    manufacturer: 'Good Smile Company',
    discoveryQuery: 'first query',
    discoveryMethod: 'firecrawl_search',
    lastSeenAt: '2026-07-16T00:00:00.000Z',
  }
  const firstRun = await store.createRun({ query: '柴郡', sourceMode: 'official_sources', characterSlug: 'cheshire' })
  assert.equal((await store.upsertProduct(firstRun.runId, base)).state, 'new')
  const secondRun = await store.createRun({ query: '柴郡', sourceMode: 'official_sources', characterSlug: 'cheshire' })
  const result = await store.upsertProduct(secondRun.runId, {
    ...base,
    discoveryQuery: 'second query',
    discoveryMethod: 'seed_official_url',
    lastSeenAt: '2026-07-17T00:00:00.000Z',
  })
  assert.equal(result.state, 'unchanged')
})

test('product snapshots are new, unchanged, then changed without erasing run history', async (t) => {
  const { root, store } = await temporaryStore(t)
  const run1 = await store.createRun({ query: 'synthetic-character' })
  const original = {
    sourceType: 'hpoi',
    sourceItemId: '100',
    sourceUrl: 'https://www.hpoi.net/hobby/100',
    title: 'Synthetic Figure',
    manufacturer: 'Example Factory',
    parsedAt: '2026-07-16T00:00:00.000Z',
    collectedAt: '2026-07-16T00:00:01.000Z',
  }
  assert.equal((await store.upsertProduct(run1.runId, original)).state, 'new')

  const run2 = await store.createRun({ query: 'synthetic-character' })
  const nonCredentialMarker = ['must', 'not', 'persist'].join('-')
  const unchanged = await store.upsertProduct(run2.runId, {
    ...original,
    parsedAt: '2026-07-17T00:00:00.000Z',
    collectedAt: '2026-07-17T00:00:01.000Z',
    observedAt: '2026-07-17T00:00:02.000Z',
    requestRecord: { retries: 2, authorization: nonCredentialMarker },
  })
  assert.equal(unchanged.state, 'unchanged')
  assert.equal(unchanged.record.lastParsedAt, '2026-07-17T00:00:00.000Z')
  assert.equal(Object.hasOwn(unchanged.record.fields, 'requestRecord'), false)

  const run3 = await store.createRun({ query: 'synthetic-character' })
  const changed = await store.upsertProduct(run3.runId, {
    ...original,
    manufacturer: 'Changed Factory',
    parsedAt: '2026-07-18T00:00:00.000Z',
  })
  assert.equal(changed.state, 'changed')
  assert.deepEqual(changed.changedFields, ['manufacturer'])
  assert.equal(changed.record.changeHistory.length, 1)
  assert.notEqual(changed.record.changeHistory[0].beforeDigest, changed.record.changeHistory[0].afterDigest)

  const summaries = JSON.parse(await readFile(path.join(root, 'runs', run3.runId, 'products.json'), 'utf8'))
  assert.equal(summaries[0].state, 'changed')
  assert.deepEqual(summaries[0].changedFields, ['manufacturer'])
  const firstRunSummary = JSON.parse(await readFile(path.join(root, 'runs', run1.runId, 'products.json'), 'utf8'))
  assert.equal(firstRunSummary[0].state, 'new')
})

test('preferences persist exclusions, restores, preferred covers, and notes without deleting objects', async (t) => {
  const { root, store } = await temporaryStore(t)
  await store.excludeProduct('hpoi-id-100')
  await store.excludeImage('a'.repeat(64))
  await store.setPreferredCover('hpoi-id-100', 'b'.repeat(64))
  await store.setManualNote('hpoi-id-100', 'keep side pose')

  const reopened = await new GalleryStore(root).initialize()
  let preferences = await reopened.readPreferences()
  assert.deepEqual(preferences.excludedProductIds, ['hpoi-id-100'])
  assert.deepEqual(preferences.excludedImageSha256, ['a'.repeat(64)])
  assert.equal(preferences.preferredCoverImage['hpoi-id-100'], 'b'.repeat(64))
  assert.equal(preferences.manualNote['hpoi-id-100'], 'keep side pose')

  await reopened.restoreProduct('hpoi-id-100')
  await reopened.restoreImage('a'.repeat(64))
  preferences = await reopened.readPreferences()
  assert.deepEqual(preferences.excludedProductIds, [])
  assert.deepEqual(preferences.excludedImageSha256, [])
  assert.equal(preferences.preferredCoverImage['hpoi-id-100'], 'b'.repeat(64))
})

test('request records persist only safe Firecrawl summary fields', async (t) => {
  const { root, store } = await temporaryStore(t)
  const run = await store.createRun({ query: 'synthetic-character' })
  const nonCredentialMarker = ['must', 'not', 'persist'].join('-')
  const urlSecret = ['url', 'secret', 'marker'].join('-')
  await store.recordRequest(run.runId, {
    url: `https://user:${urlSecret}@www.hpoi.net/charactar/1?token=${urlSecret}&page=1`,
    requestType: 'character',
    startedAt: '2026-07-16T00:00:00.000Z',
    endedAt: '2026-07-16T00:00:01.000Z',
    durationMs: 1_000,
    firecrawlSuccess: false,
    statusCode: 403,
    finalSourceUrl: `https://www.hpoi.net/charactar/1?session=${urlSecret}&page=1`,
    retries: 2,
    creditUsage: 1,
    creditUsageKind: 'reported_plus_estimated_retries',
    failureCategory: 'http_403',
    apiKey: nonCredentialMarker,
    authorization: nonCredentialMarker,
    headers: { authorization: nonCredentialMarker },
  })
  const requests = JSON.parse(await readFile(path.join(root, 'runs', run.runId, 'requests.json'), 'utf8'))
  assert.deepEqual(Object.keys(requests[0]), [
    'url',
    'requestType',
    'startedAt',
    'endedAt',
    'durationMs',
    'firecrawlSuccess',
    'statusCode',
    'finalSourceUrl',
    'retries',
    'creditUsage',
    'creditUsageKind',
    'failureCategory',
  ])
  assert.equal(JSON.stringify(requests).includes(nonCredentialMarker), false)
  assert.equal(JSON.stringify(requests).includes(urlSecret), false)
  assert.equal(requests[0].url, 'https://www.hpoi.net/charactar/1?page=1')
  assert.equal(requests[0].finalSourceUrl, 'https://www.hpoi.net/charactar/1?page=1')
  const finalized = await store.finalizeRun(run.runId, { status: 'failed', counters: run.counters })
  assert.equal(finalized.counters.firecrawlOperations, 1)
  assert.equal(finalized.counters.firecrawlRequests, 3)
  assert.equal(finalized.counters.firecrawlCredits, 1)
})

test('requested run ID is honored exactly and unsafe or duplicate IDs are rejected', async (t) => {
  const { store } = await temporaryStore(t)
  const run = await store.createRun({ query: 'synthetic-character', requestedRunId: 'owner-run-001' })
  assert.equal(run.runId, 'owner-run-001')
  await assert.rejects(
    store.createRun({ query: 'synthetic-character', requestedRunId: '../escape' }),
    /safe filename segment/,
  )
  await assert.rejects(
    store.createRun({ query: 'synthetic-character', requestedRunId: 'owner-run-001' }),
    (error) => error?.code === 'EEXIST',
  )
})

test('per-run product and image snapshots do not drift after a later collection changes the global record', async (t) => {
  const { root, store } = await temporaryStore(t)
  const oldSha = 'a'.repeat(64)
  const newSha = 'b'.repeat(64)
  const run1 = await store.createRun({ query: 'synthetic-character', requestedRunId: 'run-old' })
  const first = await store.upsertProduct(run1.runId, {
    sourceType: 'hpoi',
    sourceItemId: '100',
    sourceUrl: 'https://www.hpoi.net/hobby/100',
    title: 'Old title',
  })
  await store.registerImage({
    runId: run1.runId,
    productKey: first.productKey,
    url: 'https://img.example.test/old.png',
    sourceProductUrl: 'https://www.hpoi.net/hobby/100',
    image: {
      sha256: oldSha,
      extension: 'png',
      mime: 'image/png',
      bytes: 100,
      width: 8,
      height: 6,
      path: store.objectPath(oldSha, 'png'),
    },
  })

  const run2 = await store.createRun({ query: 'synthetic-character', requestedRunId: 'run-new' })
  const second = await store.upsertProduct(run2.runId, {
    sourceType: 'hpoi',
    sourceItemId: '100',
    sourceUrl: 'https://www.hpoi.net/hobby/100',
    title: 'New title',
  })
  await store.registerImage({
    runId: run2.runId,
    productKey: second.productKey,
    url: 'https://img.example.test/new.png',
    sourceProductUrl: 'https://www.hpoi.net/hobby/100',
    image: {
      sha256: newSha,
      extension: 'png',
      mime: 'image/png',
      bytes: 101,
      width: 9,
      height: 7,
      path: store.objectPath(newSha, 'png'),
    },
  })

  const oldGallery = await loadRunGallery(root, run1.runId)
  assert.equal(oldGallery.products[0].title, 'Old title')
  assert.deepEqual(oldGallery.products[0].images.map((image) => image.sha256), [oldSha])
  const newGallery = await loadRunGallery(root, run2.runId)
  assert.equal(newGallery.products[0].title, 'New title')
  assert.deepEqual(newGallery.products[0].images.map((image) => image.sha256), [oldSha, newSha])
})
