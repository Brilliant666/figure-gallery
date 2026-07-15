import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createJobManager, createPersonalGalleryServer } from '../../src/server/server.js'
import { createDefaultRuntime, summarizeRequestRecords } from '../../src/server/runtime-adapter.js'

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
    async savePreferences(value) {
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
    /Live gate must pass before the provider is constructed/,
  )
})

test('Firecrawl accounting counts every physical retry attempt', () => {
  assert.deepEqual(
    summarizeRequestRecords([
      { retries: 2, creditUsage: 3 },
      { retries: 0, creditUsage: 1 },
    ]),
    { requests: 4, credits: 4 },
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
  const first = firstRuntime.runCollector({ gate: { allowed: true }, query: 'synthetic-one' })
  await started

  await assert.rejects(
    secondRuntime.runCollector({ gate: { allowed: true }, query: 'synthetic-two' }),
    { code: 'COLLECTION_ALREADY_ACTIVE' },
  )
  assert.equal(providerConstructions, 1)

  allowFirstToFinish()
  await first
  const afterRelease = await secondRuntime.runCollector({ gate: { allowed: true }, query: 'synthetic-three' })
  assert.equal(afterRelease.status, 'completed')
  assert.equal(providerConstructions, 2)
})

test('default runtime passes an ASCII requested run ID through the real collector and store', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-runtime-integration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const localConfig = config(root)
  const syntheticProvider = {
    scrape() {
      throw new Error('scrape marker must not be called directly by this synthetic provider')
    },
    async fetchCharacterPage({ url }) {
      return {
        status: 200,
        finalUrl: url,
        rawHtml:
          '<!doctype html><html data-fixture="synthetic"><body><h1>柴郡</h1><a href="/hobby/990005">Synthetic product</a></body></html>',
        links: ['https://www.hpoi.net/hobby/990005'],
        images: [],
      }
    },
    async fetchProductPage({ url }) {
      return {
        status: 200,
        finalUrl: url,
        rawHtml:
          '<!doctype html><html data-fixture="synthetic"><body><div class="hpoi-infoList-item"><span>名称</span><p>Synthetic product</p></div><div class="hpoi-infoList-item"><span>制作</span><p>Synthetic maker</p></div></body></html>',
        links: [],
        images: [],
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
    characterUrl: 'https://www.hpoi.net/charactar/990005',
    requestedRunId,
    limits: {
      maxImagesPerProduct: 1,
      maxListPages: 1,
      maxProducts: 1,
      maxRetries: 0,
      requestDelayMs: 0,
    },
  })
  assert.equal(result.runId, requestedRunId)
  assert.equal(result.status, 'completed')
  assert.equal((await runtime.loadRunGallery(requestedRunId)).products[0].title, 'Synthetic product')
})

test('job status exposes deterministic disambiguation candidates for owner selection', async () => {
  const manager = createJobManager(
    config('unused', {
      firecrawlApiKey: 'synthetic-test-key',
      liveFetchEnabled: true,
      writtenPermissionConfirmed: true,
    }),
    {
      async runCollector() {
        return {
          status: 'needs_disambiguation',
          disambiguationCandidates: [
            { title: 'Synthetic Cheshire', work: 'Synthetic Work', url: 'https://www.hpoi.net/charactar/990001' },
          ],
        }
      },
    },
  )
  const started = await manager.start({ query: '柴郡', confirmSourcePermission: true })
  assert.equal(started.accepted, true)
  await new Promise((resolve) => setImmediate(resolve))
  const status = manager.status()
  assert.equal(status.status, 'needs_disambiguation')
  assert.equal(status.disambiguationCandidates[0].work, 'Synthetic Work')
})

test('job exposes a stable gallery URL immediately and reserves it through stopping', async () => {
  let calls = 0
  let firstRequestedRunId
  const manager = createJobManager(
    config('unused', {
      firecrawlApiKey: 'synthetic-test-key',
      liveFetchEnabled: true,
      writtenPermissionConfirmed: true,
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

  const started = await manager.start({ query: '柴郡', confirmSourcePermission: true })
  assert.equal(started.accepted, true)
  assert.equal(started.job.runId, firstRequestedRunId)
  assert.match(firstRequestedRunId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
  assert.equal(started.job.galleryUrl, `/gallery/${encodeURIComponent(firstRequestedRunId)}`)
  assert.equal(manager.stop().stopped, true)

  const immediateRestart = await manager.start({ query: '柴郡', confirmSourcePermission: true })
  assert.equal(immediateRestart.statusCode, 409)
  assert.equal(immediateRestart.job.status, 'stopping')

  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const afterCompletion = await manager.start({ query: '柴郡', confirmSourcePermission: true })
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
  assert.match(await home.text(), /明确书面许可/)
  assert.match(home.headers.get('content-security-policy'), /connect-src 'self'/)

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
    body: JSON.stringify({ query: 'synthetic', confirmSourcePermission: true }),
  })
  assert.equal(crossOriginMutation.status, 403)
  assert.equal(calls.collector, 0)

  const noJsonMutation = await fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ query: 'synthetic', confirmSourcePermission: true }),
  })
  assert.equal(noJsonMutation.status, 415)
  assert.equal(calls.collector, 0)

  const start = await fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '柴郡', confirmSourcePermission: false }),
  })
  assert.equal(start.status, 412)
  assert.equal((await start.json()).job.status, 'environment_blocked')
  assert.equal(calls.collector, 0)

  const preferences = await fetch(`${base}/api/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ excludedProductIds: ['synthetic'] }),
  })
  assert.equal(preferences.status, 200)
  assert.deepEqual((await preferences.json()).preferences.excludedProductIds, ['synthetic'])
})

test('same-origin JSON stop request stops an active HTTP job', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-server-stop-'))
  const application = createPersonalGalleryServer({
    config: config(root, {
      firecrawlApiKey: 'synthetic-test-key',
      liveFetchEnabled: true,
      writtenPermissionConfirmed: true,
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
      async savePreferences(value) { return value },
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
    body: JSON.stringify({ query: '柴郡', confirmSourcePermission: true }),
  })
  assert.equal(start.status, 202)
  const stop = await fetch(`${base}/api/runs/stop`, { method: 'POST', headers, body: '{}' })
  assert.equal(stop.status, 202)
  assert.equal((await stop.json()).job.status, 'stopping')
  await new Promise((resolve) => setImmediate(resolve))
  const status = await fetch(`${base}/api/status`)
  assert.equal((await status.json()).active.status, 'stopped')
})
