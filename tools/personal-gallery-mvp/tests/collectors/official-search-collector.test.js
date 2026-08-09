import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { OfficialSearchCollector } from '../../src/collectors/official-search-collector.js'
import { OfficialProviderBlockedError } from '../../src/providers/official-web-search-provider.js'
import { resolveBuiltinCharacter, validateCharacterConfig } from '../../src/characters/registry.js'

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const fixture = (name) => readFile(path.join(fixtures, name), 'utf8')
const cheshire = validateCharacterConfig({ ...resolveBuiltinCharacter('cheshire'), reviewedSeeds: [] })

class MemoryStore {
  constructor() {
    this.runs = new Map()
    this.products = new Map()
    this.requests = []
    this.failures = []
    this.warnings = []
    this.nextRun = 1
  }

  async createRun(input) {
    const runId = input.requestedRunId || `official-run-${this.nextRun++}`
    const run = { ...input, runId, counters: {}, status: 'running' }
    this.runs.set(runId, { ...run, snapshots: [] })
    return run
  }

  async updateRun(runId, mutate) {
    const next = mutate(this.runs.get(runId))
    this.runs.set(runId, next)
    return next
  }

  async recordRequest(runId, record) { this.requests.push({ runId, ...record }) }
  async recordFailure(runId, record) { this.failures.push({ runId, ...record }) }
  async recordWarning(runId, record) { this.warnings.push({ runId, ...record }) }

  async upsertProduct(runId, product) {
    const productKey = `official-${product.sourceDomain}-${product.officialProductId || createHash('sha256').update(product.sourceUrl).digest('hex')}`
    const fields = structuredClone(product)
    delete fields.parsedAt
    delete fields.discoveryQuery
    delete fields.discoveryMethod
    const digest = createHash('sha256').update(JSON.stringify(fields)).digest('hex')
    const current = this.products.get(productKey)
    const state = !current ? 'new' : current.digest === digest ? 'unchanged' : 'changed'
    this.products.set(productKey, { digest, fields: structuredClone(product) })
    this.runs.get(runId).snapshots.push({ productKey, state, fields: structuredClone(product) })
    return { productKey, state, record: current || null }
  }

  async finalizeRun(runId, { status, stopReason, counters, extra }) {
    const current = this.runs.get(runId)
    const run = { ...current, ...extra, status, stopReason, counters }
    this.runs.set(runId, run)
    return run
  }
}

function requestRecord(index, requestType) {
  return {
    url: null,
    requestType,
    startedAt: `2031-01-02T03:04:${String(index).padStart(2, '0')}.000Z`,
    endedAt: `2031-01-02T03:04:${String(index).padStart(2, '0')}.100Z`,
    durationMs: 100,
    firecrawlSuccess: true,
    statusCode: 200,
    finalSourceUrl: null,
    retries: 0,
    creditUsage: 1,
    creditUsageKind: 'reported',
    failureCategory: null,
  }
}

test('official collector aggregates five queries, uses seed provenance, and is idempotent on round two', async () => {
  const goodSmileHtml = await fixture('goodsmile-product.synthetic.html')
  const alterHtml = await fixture('alter-product.synthetic.html')
  const relatedOnlyHtml = await fixture('official-related-only.synthetic.html')
  const store = new MemoryStore()
  const calls = { searches: [], scrapes: [] }
  let requestIndex = 0
  const goodSmileUrl = 'https://www.goodsmile.com/en/product/19001/cheshire-summery-date'
  const relatedUrl = 'https://www.goodsmile.com/en/product/19004/belfast'
  const alterUrl = 'https://alter-web.jp/products/19002'
  const provider = {
    async searchOfficialProducts(query) {
      calls.searches.push(query)
      requestIndex += 1
      return {
        candidates: [
          { url: goodSmileUrl, discoveryQuery: query, discoveryMethod: 'firecrawl_search' },
          ...(calls.searches.length % 5 === 1
            ? [{ url: relatedUrl, discoveryQuery: query, discoveryMethod: 'firecrawl_search' }]
            : []),
        ],
        unreviewedDomains: calls.searches.length % 5 === 1
          ? [{
              sourceDomain: 'unreviewed.example',
              url: 'https://unreviewed.example/cheshire?token=synthetic-secret&locale=en#session',
            }]
          : [],
        requestRecord: requestRecord(requestIndex, 'official_search'),
      }
    },
    async fetchOfficialProductPage({ url }) {
      calls.scrapes.push(url)
      requestIndex += 1
      const rawHtml = url.includes('goodsmile')
        ? url.includes('belfast') ? relatedOnlyHtml : goodSmileHtml
        : alterHtml
      return {
        rawHtml,
        images: [],
        links: [],
        finalUrl: url,
        status: 200,
        requestRecord: requestRecord(requestIndex, 'official_product'),
      }
    },
  }
  const objects = new Set()
  const downloadImage = async ({ url, sourceProductUrl, allowImageUrl, fetchImpl }) => {
    assert.equal(fetchImpl, null, 'production official collection must use the pinned HTTPS transport')
    assert.equal(allowImageUrl(url, { sourceProductUrl }), true)
    const sha256 = createHash('sha256').update(url).digest('hex')
    const duplicate = objects.has(sha256)
    objects.add(sha256)
    return { sha256, duplicate }
  }
  const collector = new OfficialSearchCollector({
    provider,
    store,
    downloadImage,
    sleep: async () => {},
    config: { imageMaxBytes: 20_971_520 },
  })

  const first = await collector.collect({
    query: '柴郡',
    characterConfig: cheshire,
    seedUrls: [alterUrl],
    requestedRunId: 'official-round-one',
  })
  assert.equal(calls.searches.length, 5)
  assert.equal(first.status, 'completed')
  assert.equal(first.counters.productsProcessed, 2)
  assert.equal(first.counters.productsNew, 2)
  assert.equal(first.counters.productFailures, 1)
  assert.ok(first.counters.imagesDownloaded >= 6)
  assert.equal(first.counters.uniqueObjects, first.counters.imagesDownloaded)
  assert.equal(first.counters.duplicateImages, 0)
  assert.equal(first.counters.unreviewedDomains, 1)
  assert.equal(first.unreviewedDomains[0].url, 'https://unreviewed.example/cheshire')
  assert.equal(first.unreviewedDomains[0].sourceUrl, 'https://unreviewed.example/cheshire')
  assert.equal(JSON.stringify(first.unreviewedDomains).includes('synthetic-secret'), false)
  assert.equal(store.products.get('official-goodsmile.com-GSC-SYN-19001').fields.discoveryMethod, 'firecrawl_search')
  assert.equal(store.products.get('official-alter-web.jp-ALT-SYN-19002').fields.discoveryMethod, 'seed_official_url')

  const firstObjectCount = objects.size
  const second = await collector.collect({
    query: '柴郡',
    characterConfig: cheshire,
    seedUrls: [alterUrl],
    requestedRunId: 'official-round-two',
  })
  assert.equal(calls.searches.length, 10)
  assert.equal(second.status, 'completed')
  assert.equal(second.counters.productsNew, 0)
  assert.equal(second.counters.productsUnchanged, 2)
  assert.equal(second.counters.productsChanged, 0)
  assert.equal(second.counters.uniqueObjects, 0)
  assert.equal(second.counters.duplicateImages, second.counters.imagesDownloaded)
  assert.equal(objects.size, firstObjectCount)
  assert.notDeepEqual(store.runs.get('official-round-one'), store.runs.get('official-round-two'))
})

test('candidate and product hard caps stop at 20 without scraping unreviewed domains', async () => {
  const store = new MemoryStore()
  const scraped = []
  let requestIndex = 0
  const provider = {
    async searchOfficialProducts() {
      requestIndex += 1
      return {
        candidates: Array.from({ length: 25 }, (_value, index) => ({
          url: `https://goodsmile.com/en/product/${index + 1}/synthetic-cheshire`,
          discoveryMethod: 'firecrawl_search',
        })),
        unreviewedDomains: [{ sourceDomain: 'outside.example', url: 'https://outside.example/item' }],
        requestRecord: requestRecord(requestIndex, 'official_search'),
      }
    },
    async fetchOfficialProductPage({ url }) {
      scraped.push(url)
      requestIndex += 1
      return { rawHtml: '<main>synthetic</main>', finalUrl: url, requestRecord: requestRecord(requestIndex, 'official_product') }
    },
  }
  const parser = ({ url }) => ({
    sourceType: 'official',
    sourceKind: 'official_manufacturer',
    sourceDomain: 'goodsmile.com',
    officialProductId: new URL(url).pathname.split('/')[3],
    sourceUrl: url,
    title: 'Synthetic Cheshire',
    classification: 'unknown',
    imageUrls: [],
  })
  const result = await new OfficialSearchCollector({ provider, store, parser, downloadImage: async () => assert.fail() })
    .collect({ query: '柴郡', characterConfig: cheshire, limits: { maxCandidates: 20, maxProducts: 20 } })

  assert.equal(result.status, 'partial_by_limit')
  assert.equal(result.stopReason, 'max_candidates')
  assert.equal(result.counters.officialCandidates, 25)
  assert.equal(result.counters.productsProcessed, 20)
  assert.equal(scraped.length, 20)
  assert.equal(scraped.some((url) => url.includes('outside.example')), false)
})

test('a blocked provider result is converted to CollectionBlockedError and stops immediately', async () => {
  const store = new MemoryStore()
  let searches = 0
  const provider = {
    async searchOfficialProducts() {
      searches += 1
      throw new OfficialProviderBlockedError('Source access stopped: captcha.', {
        category: 'captcha',
        requestRecord: requestRecord(1, 'official_search'),
      })
    },
    async fetchOfficialProductPage() { assert.fail('blocked discovery must not scrape') },
  }
  const result = await new OfficialSearchCollector({ provider, store }).collect({ query: '柴郡', characterConfig: cheshire })
  assert.equal(searches, 1)
  assert.equal(result.status, 'blocked')
  assert.equal(result.stopReason, 'captcha')
  assert.equal(store.failures.at(-1).blocked, true)
})
