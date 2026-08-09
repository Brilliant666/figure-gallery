import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveBuiltinCharacter } from '../../src/characters/registry.js'
import { HpoiIndexCollector } from '../../src/collectors/hpoi-index-collector.js'
import { loadGalleryByQuery } from '../../src/gallery/read-model.js'
import { DiscoveryStore } from '../../src/storage/discovery-store.js'
import { GalleryStore } from '../../src/storage/gallery-store.js'

function productFields(character) {
  return {
    characterId: character.characterId,
    characterSlug: character.slug,
    sourceType: 'official',
    sourceDomain: 'goodsmile.com',
    sourceItemId: '9905001',
    officialProductId: '9905001',
    sourceUrl: 'https://www.goodsmile.com/en/product/9905001/Synthetic-Existing',
    rawTitle: 'Cheshire Synthetic Existing',
    title: 'Cheshire Synthetic Existing',
    rawCharacterNames: ['Cheshire'],
    rawWorkName: 'Azur Lane',
    rawManufacturer: 'Good Smile Company',
    manufacturer: 'Good Smile Company',
    rawCategory: 'Scale Figure',
    rawScale: '1/7',
    scale: '1/7',
    classification: 'likely_scale',
    candidateImages: [],
    imageUrls: [],
  }
}

test('index candidates are classified, matched, resolved, collected, and idempotent without direct Hpoi transport', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hpoi-index-pipeline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const character = resolveBuiltinCharacter('cheshire')
  const galleryStore = await new GalleryStore(root, { characterConfig: character }).initialize()
  const baselineRun = await galleryStore.createRun({
    query: '柴郡',
    characterConfig: character,
    characterId: character.characterId,
    characterSlug: character.slug,
    sourceMode: 'official_sources',
    requestedRunId: 'synthetic-index-baseline',
  })
  await galleryStore.upsertProduct(baselineRun.runId, productFields(character))
  await galleryStore.finalizeRun(baselineRun.runId, { status: 'completed', counters: { productsNew: 1 } })
  const discoveryStore = await new DiscoveryStore(root, { characterConfig: character }).initialize()
  const indexProvider = {
    async discoverCharacter(_character, { onRequest }) {
      onRequest?.({ requestType: 'hpoi_index_search', retries: 0, creditUsage: 3 })
      return {
        queries: ['site:hpoi.net "Cheshire" "Azur Lane" scale figure'],
        querySummaries: [{ returned: 3, accepted: 3 }],
        rawResults: 3,
        duplicateResults: 0,
        rejectedResults: 0,
        candidates: [
          {
            url: 'https://www.hpoi.net/hobby/9905001',
            title: 'Azur Lane Cheshire Synthetic Existing 1/7 scale figure [Good Smile Company]',
            description: '碧蓝航线 柴郡 比例人形 synthetic',
            query: 'synthetic index query',
            rank: 1,
          },
          {
            url: 'https://www.hpoi.net/hobby/9905002',
            title: 'Azur Lane Cheshire Synthetic New 1/7 scale figure [Good Smile Company]',
            description: '碧蓝航线 柴郡 比例人形 synthetic',
            query: 'synthetic index query',
            rank: 2,
          },
          {
            url: 'https://www.hpoi.net/hobby/9905003',
            title: 'Azur Lane Cheshire Synthetic Nendoroid 黏土人',
            description: '碧蓝航线 柴郡 synthetic',
            query: 'synthetic index query',
            rank: 3,
          },
        ],
      }
    },
  }
  const calls = { search: 0, scrape: 0 }
  const officialProvider = {
    async searchOfficialProducts(query) {
      calls.search += 1
      return {
        candidates: query.includes('Synthetic New') ? [{
          title: 'Cheshire Synthetic New',
          description: 'Azur Lane official synthetic 1/7 scale figure by Good Smile Company',
          url: 'https://www.goodsmile.com/en/product/9905002/Synthetic-New',
          sourceUrl: 'https://www.goodsmile.com/en/product/9905002/Synthetic-New',
          sourceDomain: 'www.goodsmile.com',
          discoveryQuery: query,
        }] : [],
        requestRecord: { requestType: 'official_search', retries: 0, creditUsage: 1 },
      }
    },
    async fetchOfficialProductPage({ url }) {
      calls.scrape += 1
      return {
        status: 200,
        finalUrl: url,
        rawHtml: '<!doctype html><html data-fixture="synthetic"><body><main><h1>Cheshire Synthetic New</h1><dl><dt>Series</dt><dd>Azur Lane</dd><dt>Manufacturer</dt><dd>GOOD SMILE COMPANY</dd><dt>Scale</dt><dd>1/7</dd><dt>Category</dt><dd>Scale Figure</dd></dl><p class="product-description">Official synthetic Cheshire product for offline tests.</p></main></body></html>',
        renderedHtml: '',
        links: [],
        images: [],
        requestRecord: { requestType: 'official_product', retries: 0, creditUsage: 1 },
      }
    },
  }
  const config = {
    hpoiIndexMaxQueries: 1,
    hpoiIndexMaxResultsPerQuery: 3,
    hpoiIndexMaxRawResults: 20,
    officialMaxSearchResultsPerQuery: 3,
    officialMaxImagesPerProduct: 2,
    officialRequestDelayMs: 1_000,
    officialImageRequestDelayMs: 1_000,
    imageMaxBytes: 1_000_000,
  }
  const makeCollector = () => new HpoiIndexCollector({
    indexProvider,
    officialProvider,
    galleryStore,
    discoveryStore,
    root,
    config,
  })
  const first = await makeCollector().collect({
    query: '柴郡',
    characterConfig: character,
    requestedRunId: 'synthetic-hidx-first',
  })
  assert.equal(first.status, 'completed')
  assert.deepEqual(
    {
      indexed: first.metrics.hpoiIndexedCandidates,
      inScope: first.metrics.inScope,
      existing: first.metrics.alreadyCollected,
      newTargets: first.metrics.newTargets,
      resolved: first.metrics.officialResolved,
      collected: first.metrics.collected,
      outOfScope: first.metrics.outOfScope,
    },
    { indexed: 3, inScope: 2, existing: 1, newTargets: 1, resolved: 1, collected: 1, outOfScope: 1 },
  )
  assert.equal(first.newProducts, 1)
  assert.equal((await loadGalleryByQuery(root, 'cheshire')).summary.products, 2)
  assert.deepEqual(first.directAccess, {
    hpoiDirectHttpRequests: 0,
    hpoiDirectBrowserNavigations: 0,
    hpoiScrapeRequests: 0,
    hpoiApiRequests: 0,
  })

  const searchAfterFirst = calls.search
  const scrapeAfterFirst = calls.scrape
  const second = await makeCollector().collect({
    query: '柴郡',
    characterConfig: character,
    requestedRunId: 'synthetic-hidx-second',
  })
  assert.equal(second.candidateCreated, 0)
  assert.equal(second.newProducts, 0)
  assert.equal(second.newObjects, 0)
  assert.equal(calls.search, searchAfterFirst)
  assert.equal(calls.scrape, scrapeAfterFirst)
  assert.equal(second.preferencesPreserved, true)
})
