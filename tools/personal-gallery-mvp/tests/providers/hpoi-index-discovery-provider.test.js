import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveBuiltinCharacter } from '../../src/characters/registry.js'
import { HpoiIndexDiscoveryProvider } from '../../src/providers/hpoi-index-discovery-provider.js'

const gate = { allowed: true, missing: [] }

test('provider uses only Firecrawl Search v2 and stores indexed Hpoi URLs without requesting them', async () => {
  const calls = []
  const client = {
    async search(query, options) {
      calls.push({ method: 'search', query, options })
      return {
        web: [
          { url: 'https://www.hpoi.net/hobby/9903001', title: 'Azur Lane Cheshire Synthetic 1/7 scale figure', description: '碧蓝航线 柴郡 synthetic' },
          { url: 'https://hpoi.net/hobby/9903001?utm_source=duplicate', title: 'duplicate', description: 'synthetic' },
          { url: 'https://www.hpoi.net/charactar/1', title: 'not a product', description: 'synthetic' },
        ],
      }
    },
    async scrape() { throw new Error('scrape must never be called') },
  }
  const provider = new HpoiIndexDiscoveryProvider({
    apiKey: 'synthetic-test-key',
    gate,
    client,
    maxRetries: 0,
    requestDelayMs: 1_000,
    sleep: async () => {},
  })
  const result = await provider.discoverCharacter(resolveBuiltinCharacter('cheshire'), {
    maxQueries: 2,
    maxResultsPerQuery: 3,
    maxRawResults: 20,
  })
  assert.equal(calls.length, 2)
  assert.ok(calls.every((call) => call.method === 'search'))
  assert.ok(calls.every((call) => call.query.startsWith('site:hpoi.net ')))
  assert.ok(calls.every((call) => JSON.stringify(call.options) === JSON.stringify({ sources: ['web'], includeDomains: ['hpoi.net'], limit: 3 })))
  assert.equal(result.candidates.length, 1)
  assert.equal(result.duplicateResults, 3)
  assert.equal(result.rejectedResults, 2)
  assert.deepEqual(
    [result.hpoiDirectHttpRequests, result.hpoiDirectBrowserNavigations, result.hpoiScrapeRequests, result.hpoiApiRequests],
    [0, 0, 0, 0],
  )
})

test('429 is terminal and cannot trigger retry or proxy fallback', async () => {
  let calls = 0
  const provider = new HpoiIndexDiscoveryProvider({
    apiKey: 'synthetic-test-key',
    gate,
    client: {
      async search() {
        calls += 1
        throw Object.assign(new Error('rate limited'), { status: 429 })
      },
    },
    maxRetries: 2,
    requestDelayMs: 1_000,
    sleep: async () => {},
  })
  await assert.rejects(
    provider.searchIndexedHpoi('site:hpoi.net "Synthetic" figure'),
    (error) => error.blocked === true && error.category === 'http_429',
  )
  assert.equal(calls, 1)
})

test('a terminal later query preserves earlier indexed candidates without continuing', async () => {
  let calls = 0
  const records = []
  const provider = new HpoiIndexDiscoveryProvider({
    apiKey: 'synthetic-test-key',
    gate,
    client: {
      async search() {
        calls += 1
        if (calls === 1) {
          return {
            web: [{
              url: 'https://www.hpoi.net/hobby/9903999',
              title: 'Azur Lane Cheshire Synthetic 1/7 scale figure',
              description: '碧蓝航线 柴郡 synthetic',
            }],
          }
        }
        throw Object.assign(new Error('rate limited'), { status: 429 })
      },
    },
    maxRetries: 2,
    requestDelayMs: 1_000,
    sleep: async () => {},
  })
  await assert.rejects(
    provider.discoverCharacter(resolveBuiltinCharacter('cheshire'), {
      maxQueries: 3,
      maxResultsPerQuery: 3,
      maxRawResults: 20,
      onRequest: (record) => records.push(record),
    }),
    (error) => {
      assert.equal(error.blocked, true)
      assert.equal(error.category, 'http_429')
      assert.equal(error.partialDiscovery.candidates.length, 1)
      assert.equal(error.partialDiscovery.querySummaries.at(-1).status, 'blocked')
      return true
    },
  )
  assert.equal(calls, 2)
  assert.equal(records.length, 2)
})
