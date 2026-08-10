import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createJobManager, createPersonalGalleryServer } from '../../src/server/server.js'
import { createDefaultRuntime, summarizeRequestRecords } from '../../src/server/runtime-adapter.js'
import { validateCharacterConfig } from '../../src/characters/registry.js'

const syntheticCheshire = validateCharacterConfig({
  characterId: 'synthetic:cheshire',
  slug: 'synthetic-cheshire',
  displayName: 'Synthetic Cheshire',
  aliases: ['Synthetic Cheshire', 'Cheshire'],
  workNames: ['Azur Lane'],
  reviewedSeeds: [],
})

function config(root, overrides = {}) {
  return {
    defaultQuery: '柴郡',
    firecrawlApiKey: null,
    firecrawlBaseUrl: 'https://api.firecrawl.dev',
    host: '127.0.0.1',
    imageMaxBytes: 20_971_520,
    liveFetchEnabled: false,
    maxImagesPerProduct: 5,
    maxListPages: 20,
    maxProducts: 200,
    maxRetries: 2,
    port: 0,
    requestConcurrency: 1,
    requestDelayMs: 1_500,
    root,
    writtenPermissionConfirmed: false,
    officialLiveFetchEnabled: false,
    officialMaxSearchResultsPerQuery: 10,
    officialMaxQueries: 30,
    officialMaxCandidates: 20,
    officialMaxProducts: 20,
    officialMaxImagesPerProduct: 10,
    officialRequestDelayMs: 1_000,
    officialImageRequestDelayMs: 1_000,
    officialMaxRetries: 2,
    ...overrides,
  }
}

function runtime(calls) {
  let preferences = {
    excludedProductIds: [],
    excludedImageSha256: [],
    preferredCoverImage: {},
    manualNote: {},
  }
  return {
    async runCollector() {
      calls.collector += 1
      return { status: 'completed' }
    },
    async listRecentRuns() {
      return []
    },
    async loadRunGallery() {
      return null
    },
    async loadGalleryByQuery() {
      return null
    },
    async savePreferences(_characterSlug, value) {
      preferences = value
      return preferences
    },
  }
}

test('refuses non-loopback binding before creating a server', () => {
  assert.throws(
    () => createPersonalGalleryServer({ config: config('unused', { host: '0.0.0.0' }), runtime: runtime({}) }),
    /only bind to 127\.0\.0\.1/,
  )
})

test('default runtime rejects a closed gate before constructing a provider or collector run', async () => {
  const localConfig = config('unused')
  await assert.rejects(
    createDefaultRuntime(localConfig).runCollector({ gate: { allowed: false }, query: '柴郡' }),
    /Official live gate must pass before the provider is constructed/,
  )
})

test('Firecrawl accounting counts every physical retry attempt', () => {
  assert.deepEqual(
    summarizeRequestRecords([
      { retries: 2, creditUsage: 3 },
      { retries: 0, creditUsage: 1 },
    ]),
    { requests: 4, searchRequests: 0, scrapeRequests: 0, credits: 4 },
  )
})

test('two independent runtimes cannot overlap provider-backed collection', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-runtime-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const localConfig = config(root)
  let allowFirstToFinish
  let firstStarted
  const started = new Promise((resolve) => { firstStarted = resolve })
  const hold = new Promise((resolve) => { allowFirstToFinish = resolve })
  let providerConstructions = 0
  const runtimeOptions = {
    providerFactory() {
      providerConstructions += 1
      return {}
    },
    collectorLoader: async () => async () => {
      firstStarted()
      await hold
      return { status: 'completed', counters: {} }
    },
  }
  const firstRuntime = createDefaultRuntime(localConfig, runtimeOptions)
  const secondRuntime = createDefaultRuntime(localConfig, runtimeOptions)
  const first = firstRuntime.runCollector({ gate: { allowed: true }, query: 'synthetic-one', characterConfig: syntheticCheshire })
  await started

  await assert.rejects(
    secondRuntime.runCollector({ gate: { allowed: true }, query: 'synthetic-two', characterConfig: syntheticCheshire }),
    { code: 'COLLECTION_ALREADY_ACTIVE' },
  )
  assert.equal(providerConstructions, 1)

  allowFirstToFinish()
  await first
  const afterRelease = await secondRuntime.runCollector({ gate: { allowed: true }, query: 'synthetic-three', characterConfig: syntheticCheshire })
  assert.equal(afterRelease.status, 'completed')
  assert.equal(providerConstructions, 2)
})

test('default runtime passes an ASCII requested run ID through the official collector and store', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-runtime-integration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const localConfig = config(root)
  const syntheticProvider = {
    async searchOfficialProducts() {
      return {
        candidates: [{
          title: 'Cheshire Synthetic Dress',
          url: 'https://www.goodsmile.com/en/product/990005',
          sourceUrl: 'https://www.goodsmile.com/en/product/990005',
          sourceDomain: 'www.goodsmile.com',
          discoveryMethod: 'firecrawl_search',
          discoveryQuery: 'synthetic query',
        }],
        unreviewedDomains: [],
        requestRecord: { requestType: 'official_search', retries: 0, creditUsage: 1 },
      }
    },
    async fetchOfficialProductPage({ url }) {
      return {
        status: 200,
        finalUrl: url,
        rawHtml:
          '<!doctype html><html data-fixture="synthetic"><body><main><h1>Cheshire Synthetic Dress</h1><dl><dt>Series</dt><dd>Azur Lane</dd><dt>Manufacturer</dt><dd>GOOD SMILE COMPANY</dd><dt>Scale</dt><dd>1/7</dd></dl><p class="product-description">An official synthetic product description for deterministic offline testing only.</p></main></body></html>',
        links: [],
        images: [],
        requestRecord: { requestType: 'official_product', retries: 0, creditUsage: 1 },
      }
    },
  }
  const runtime = createDefaultRuntime(localConfig, {
    providerFactory: () => syntheticProvider,
  })
  const requestedRunId = 'synthetic-ascii-run-990005'
  const result = await runtime.runCollector({
    gate: { allowed: true, missing: [] },
    query: '柴郡',
    characterConfig: syntheticCheshire,
    sourceMode: 'official_sources',
    requestedRunId,
    limits: {
      maxProducts: 1,
      maxCandidates: 1,
      maxImagesPerProduct: 1,
      searchLimit: 1,
      requestDelayMs: 1_000,
      imageMaxBytes: 1_000_000,
    },
  })
  assert.equal(result.runId, requestedRunId)
  assert.equal(result.status, 'completed')
  assert.equal((await runtime.loadRunGallery(requestedRunId)).products[0].title, 'Cheshire Synthetic Dress')
  assert.equal(result.hpoiRequests, 0)
})

test('job manager rejects every attempt to restore a Hpoi live input', async () => {
  const manager = createJobManager(
    config('unused', {
      firecrawlApiKey: 'synthetic-test-key',
      officialLiveFetchEnabled: true,
    }),
    { async runCollector() { throw new Error('must not run') } },
  )
  const started = await manager.start({
    query: '柴郡',
    sourceMode: 'hpoi',
    characterUrl: 'https://www.hpoi.net/charactar/1',
    confirmOfficialSourceAccess: true,
  })
  assert.equal(started.accepted, false)
  assert.equal(started.statusCode, 410)
  assert.equal(started.error, 'hpoi_live_source_disabled')
})

test('job exposes a stable gallery URL immediately and reserves it through stopping', async () => {
  let calls = 0
  let firstRequestedRunId
  const manager = createJobManager(
    config('unused', {
      firecrawlApiKey: 'synthetic-test-key',
      officialLiveFetchEnabled: true,
    }),
    {
      async runCollector({ requestedRunId, signal }) {
        calls += 1
        if (calls > 1) return { status: 'completed', runId: requestedRunId }
        firstRequestedRunId = requestedRunId
        return new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => setImmediate(() => resolve({ status: 'stopped', runId: requestedRunId })),
            { once: true },
          )
        })
      },
    },
  )

  const started = await manager.start({ query: '柴郡', sourceMode: 'official_sources', confirmOfficialSourceAccess: true })
  assert.equal(started.accepted, true)
  assert.equal(started.job.runId, firstRequestedRunId)
  assert.match(firstRequestedRunId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
  assert.equal(started.job.galleryUrl, '/gallery/characters/cheshire')
  assert.equal(manager.stop().stopped, true)

  const immediateRestart = await manager.start({ query: '柴郡', sourceMode: 'official_sources', confirmOfficialSourceAccess: true })
  assert.equal(immediateRestart.statusCode, 409)
  assert.equal(immediateRestart.job.status, 'stopping')

  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const afterCompletion = await manager.start({ query: '柴郡', sourceMode: 'official_sources', confirmOfficialSourceAccess: true })
  assert.equal(afterCompletion.accepted, true)
})

test('serves the local UI and blocks collection before constructing network work', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-server-'))
  const calls = { collector: 0 }
  const application = createPersonalGalleryServer({ config: config(root), runtime: runtime(calls) })
  t.after(async () => {
    await application.close()
    await rm(root, { recursive: true, force: true })
  })
  const address = await application.listen()
  const base = `http://127.0.0.1:${address.port}`

  const home = await fetch(`${base}/`)
  assert.equal(home.status, 200)
  assert.match(await home.text(), /Official sources/)
  assert.match(home.headers.get('content-security-policy'), /connect-src 'self'/)
  assert.match(
    home.headers.get('content-security-policy'),
    /img-src 'self' https:\/\/cdn\.shopify\.com https:\/\/images\.goodsmile\.info https:\/\/www\.goodsmile\.com/,
  )

  const reboundStatus = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/`, { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.end()
  })
  assert.equal(reboundStatus, 421)

  const crossOriginMutation = await fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Origin: 'https://attacker.example',
      'Sec-Fetch-Site': 'cross-site',
    },
    body: JSON.stringify({ query: 'synthetic', sourceMode: 'official_sources', confirmOfficialSourceAccess: true }),
  })
  assert.equal(crossOriginMutation.status, 403)
  assert.equal(calls.collector, 0)

  const noJsonMutation = await fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ query: 'synthetic', sourceMode: 'official_sources', confirmOfficialSourceAccess: true }),
  })
  assert.equal(noJsonMutation.status, 415)
  assert.equal(calls.collector, 0)

  const start = await fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '柴郡', sourceMode: 'official_sources', confirmOfficialSourceAccess: false }),
  })
  assert.equal(start.status, 412)
  assert.equal((await start.json()).job.status, 'environment_blocked')
  assert.equal(calls.collector, 0)

  const preferences = await fetch(`${base}/api/preferences/cheshire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ excludedProductIds: ['synthetic'] }),
  })
  assert.equal(preferences.status, 200)
  assert.deepEqual((await preferences.json()).preferences.excludedProductIds, ['synthetic'])
})

test('preference HTTP endpoint canonicalizes a stale retired prototype key', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-server-alias-preferences-'))
  const characterDirectory = path.join(root, 'characters', 'rem')
  await mkdir(characterDirectory, { recursive: true })
  await writeFile(path.join(characterDirectory, 'prototype-projection.json'), JSON.stringify({
    schemaVersion: 2,
    projectionVersion: 'rem-prototype-projection-v2',
    viewMode: 'prototype_projection',
    characterSlug: 'rem',
    prototypeAliases: { 'rem-proto-retired': 'rem-proto-survivor' },
    prototypes: [{ prototypeId: 'rem-proto-survivor', images: [], catalogItems: [] }],
  }))
  const localConfig = config(root)
  const application = createPersonalGalleryServer({
    config: localConfig,
    runtime: createDefaultRuntime(localConfig),
  })
  t.after(async () => {
    await application.close()
    await rm(root, { recursive: true, force: true })
  })
  const address = await application.listen()
  const base = `http://127.0.0.1:${address.port}`

  const response = await fetch(`${base}/api/preferences/rem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, Connection: 'close' },
    body: JSON.stringify({
      products: {
        'rem-proto-survivor': { manualNote: 'current page note' },
        'rem-proto-retired': { manualNote: 'stale page note' },
      },
    }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.preferences.products, {
    'rem-proto-survivor': {
      manualNote: '[rem-proto-retired] stale page note\n[rem-proto-survivor] current page note',
    },
  })
  assert.equal(Object.hasOwn(body.preferences.products, 'rem-proto-retired'), false)
})

test('same-origin JSON stop request stops an active HTTP job', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-server-stop-'))
  const application = createPersonalGalleryServer({
    config: config(root, {
      firecrawlApiKey: 'synthetic-test-key',
      officialLiveFetchEnabled: true,
    }),
    runtime: {
      async runCollector({ requestedRunId, signal }) {
        return new Promise((resolve) => signal.addEventListener(
          'abort',
          () => resolve({ runId: requestedRunId, status: 'stopped' }),
          { once: true },
        ))
      },
      async listRecentRuns() { return [] },
      async loadRunGallery() { return null },
      async loadGalleryByQuery() { return null },
      async savePreferences(_characterSlug, value) { return value },
    },
  })
  t.after(async () => {
    await application.close()
    await rm(root, { recursive: true, force: true })
  })
  const address = await application.listen()
  const base = `http://127.0.0.1:${address.port}`
  const headers = { 'Content-Type': 'application/json', Origin: base }

  const start = await fetch(`${base}/api/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: '柴郡', sourceMode: 'official_sources', confirmOfficialSourceAccess: true }),
  })
  assert.equal(start.status, 202)
  const stop = await fetch(`${base}/api/runs/stop`, { method: 'POST', headers, body: '{}' })
  assert.equal(stop.status, 202)
  assert.equal((await stop.json()).job.status, 'stopping')
  await new Promise((resolve) => setImmediate(resolve))
  const status = await fetch(`${base}/api/status`)
  assert.equal((await status.json()).active.status, 'stopped')
})
