import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import test from 'node:test'

import { CollectionBlockedError, toCollectionError } from '../../src/collectors/access-policy.js'
import {
  OFFICIAL_FIRECRAWL_METHODS,
  OfficialProviderBlockedError,
  OfficialWebSearchProvider,
  buildOfficialDiscoveryQueries,
} from '../../src/providers/official-web-search-provider.js'
import { resolveBuiltinCharacter } from '../../src/characters/registry.js'

const gate = Object.freeze({ allowed: true, missing: [] })

function clock() {
  let now = Date.parse('2031-01-02T03:04:05.000Z')
  const sleeps = []
  return {
    now: () => now,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); now += milliseconds },
    sleeps,
  }
}

test('Cheshire discovery always uses the five required English, Japanese, and Chinese queries', () => {
  const queries = buildOfficialDiscoveryQueries(resolveBuiltinCharacter('柴郡'))
  assert.deepEqual(queries, [
    '"Azur Lane" Cheshire figure',
    '"Azur Lane" Cheshire scale figure',
    'アズールレーン チェシャー フィギュア',
    '碧蓝航线 柴郡 手办',
    '碧蓝航线 柴郡 比例手办',
  ])
  const rem = buildOfficialDiscoveryQueries(resolveBuiltinCharacter('蕾姆'))
  assert.equal(rem.length, 30)
  assert.deepEqual(rem, buildOfficialDiscoveryQueries(resolveBuiltinCharacter('Rem')))
})

test('SDK retries are disabled and only the provider retry loop owns physical attempts', () => {
  const options = []
  new OfficialWebSearchProvider({
    apiKey: 'synthetic-key',
    gate,
    clientFactory(value) {
      options.push(value)
      return {}
    },
  })
  assert.deepEqual(options, [{ apiKey: 'synthetic-key', apiUrl: 'https://api.firecrawl.dev', maxRetries: 1 }])
})

test('pinned SDK performs exactly one transport attempt for one official provider attempt', async (t) => {
  const priorNoProxy = process.env.NO_PROXY
  const priorNoProxyLower = process.env.no_proxy
  process.env.NO_PROXY = [priorNoProxy, '127.0.0.1', 'localhost'].filter(Boolean).join(',')
  process.env.no_proxy = [priorNoProxyLower, '127.0.0.1', 'localhost'].filter(Boolean).join(',')
  t.after(() => {
    if (priorNoProxy === undefined) delete process.env.NO_PROXY
    else process.env.NO_PROXY = priorNoProxy
    if (priorNoProxyLower === undefined) delete process.env.no_proxy
    else process.env.no_proxy = priorNoProxyLower
  })

  const requests = []
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({
      method: request.method,
      path: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    })
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      success: true,
      data: {
        web: [{
          title: 'Synthetic Cheshire',
          url: 'https://www.goodsmile.com/en/product/19001/cheshire',
        }],
      },
    }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.close()
    await once(server, 'close')
  })

  const provider = new OfficialWebSearchProvider({
    apiKey: 'synthetic-key',
    apiUrl: `http://127.0.0.1:${server.address().port}`,
    gate,
    maxRetries: 0,
  })
  const result = await provider.searchOfficialProducts('synthetic Cheshire', { limit: 1 })
  assert.equal(result.candidates.length, 1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].path, '/v2/search')
  assert.deepEqual(requests[0].body.sources, ['web'])
  assert.deepEqual(requests[0].body.excludeDomains, ['hpoi.net', 'www.hpoi.net'])
})

test('Search v2 is web-only, explicitly excludes Hpoi, and never visits unreviewed results', async () => {
  const calls = []
  const provider = new OfficialWebSearchProvider({
    apiKey: 'synthetic-key',
    gate,
    client: {
      async search(...args) {
        calls.push(args)
        return {
          web: [
            { title: 'Allowed Good Smile', url: 'https://www.goodsmile.com/en/product/19001/cheshire' },
            { title: 'Duplicate alias', url: 'https://goodsmile.com/en/product/19001/cheshire?utm_source=x' },
            { title: 'Allowed ALTER', url: 'https://alter-web.jp/products/19002/' },
            { title: 'Hpoi must be denied', url: 'https://www.hpoi.net/hobby/1' },
            { title: 'Unreviewed', url: 'https://shop.example.test/products/cheshire' },
            { title: 'Official search page', url: 'https://www.goodsmile.com/search?q=cheshire' },
          ],
        }
      },
    },
  })
  const result = await provider.searchOfficialProducts('"Azur Lane" Cheshire figure', { limit: 10 })

  assert.deepEqual(calls, [[
    '"Azur Lane" Cheshire figure',
    {
      sources: ['web'],
      excludeDomains: ['hpoi.net', 'www.hpoi.net'],
      limit: 10,
    },
  ]])
  assert.equal(result.candidates.length, 2)
  assert.deepEqual(result.candidates.map((candidate) => candidate.sourceDomain).sort(), ['alter-web.jp', 'www.goodsmile.com'])
  assert.deepEqual(result.unreviewedDomains.map((entry) => entry.sourceDomain), ['shop.example.test'])
  assert.ok(result.rejected.some((entry) => entry.status === 'hpoi_denied'))
  assert.ok(result.rejected.some((entry) => entry.status === 'non_product_path'))
  assert.equal(result.requestRecord.requestType, 'official_search')
  assert.equal(result.requestRecord.creditUsage, 10)
  assert.deepEqual(OFFICIAL_FIRECRAWL_METHODS, ['search', 'scrape'])
})

test('scrape requests rendered html plus rawHtml, links, images, and product for allowlisted product pages', async () => {
  const calls = []
  const provider = new OfficialWebSearchProvider({
    apiKey: 'synthetic-key',
    gate,
    client: {
      async scrape(...args) {
        calls.push(args)
        return {
          html: '<main data-fixture="synthetic-rendered">Cheshire Azur Lane</main>',
          rawHtml: '<main data-fixture="synthetic">Cheshire Azur Lane</main>',
          links: [],
          images: [],
          product: { name: 'Synthetic Cheshire' },
          metadata: { sourceURL: args[0], statusCode: 200, creditsUsed: 1 },
        }
      },
    },
  })
  const result = await provider.fetchOfficialProductPage({
    url: 'https://www.goodsmile.com/en/product/19001/cheshire?utm_source=x',
  })
  assert.deepEqual(calls, [[
    'https://www.goodsmile.com/en/product/19001/cheshire',
    { formats: ['html', 'rawHtml', 'links', 'images', 'product'] },
  ]])
  assert.match(result.renderedHtml, /synthetic-rendered/)
  assert.equal(result.finalUrl, 'https://www.goodsmile.com/en/product/19001/cheshire')
  assert.equal(result.requestRecord.requestType, 'official_product')
})

test('a public product page with a navigation sign-in link is not mistaken for a login wall', async () => {
  const provider = new OfficialWebSearchProvider({
    apiKey: 'synthetic-key',
    gate,
    maxRetries: 0,
    client: {
      async scrape(url) {
        return {
          rawHtml: '<html><head><title>Cheshire Figure</title></head><body><nav><a href="/login">Please log in</a></nav><main class="product-detail"><h1>Cheshire</h1><p>Azur Lane official product.</p></main></body></html>',
          links: [],
          images: [],
          metadata: { sourceURL: url, statusCode: 200 },
        }
      },
    },
  })
  const result = await provider.fetchOfficialProductPage({
    url: 'https://www.goodsmile.com/en/product/19001/cheshire',
  })
  assert.equal(result.status, 200)
})

test('blocking content in rendered html stops even when rawHtml is only a benign script shell', async () => {
  const provider = new OfficialWebSearchProvider({
    apiKey: 'synthetic-key',
    gate,
    maxRetries: 0,
    client: {
      async scrape(url) {
        return {
          html: '<main><h1>Captcha verification required</h1></main>',
          rawHtml: '<html><body><script src="/synthetic-body.js"></script></body></html>',
          metadata: { sourceURL: url, statusCode: 200 },
        }
      },
    },
  })
  await assert.rejects(
    () => provider.fetchOfficialProductPage({ url: 'https://apex-toys.com/productinfo/3727461.html' }),
    (error) => error.category === 'captcha' && error.requestRecord.retries === 0,
  )
})

test('outside targets and blocked redirects terminate before any follow-up request', async () => {
  let calls = 0
  const provider = new OfficialWebSearchProvider({
    apiKey: 'synthetic-key',
    gate,
    client: {
      async scrape() {
        calls += 1
        return {
          rawHtml: '<main>synthetic redirect</main>',
          metadata: { sourceURL: 'https://www.hpoi.net/hobby/1', statusCode: 200 },
        }
      },
    },
  })
  await assert.rejects(
    () => provider.fetchOfficialProductPage({ url: 'https://www.hpoi.net/hobby/1' }),
    (error) => error instanceof OfficialProviderBlockedError && error.category === 'url_not_allowed',
  )
  assert.equal(calls, 0)
  await assert.rejects(
    () => provider.fetchOfficialProductPage({ url: 'https://alter-web.jp/products/19002' }),
    (error) => {
      assert.equal(error.category, 'redirect_outside_allowlist')
      assert.equal(error.requestRecord.firecrawlSuccess, false)
      const collectionError = toCollectionError(error)
      assert.ok(collectionError instanceof CollectionBlockedError)
      assert.equal(collectionError.blocked, true)
      return true
    },
  )
  assert.equal(calls, 1)
})

test('captcha is terminal and 503 retries are provider-owned, delayed, and counted', async () => {
  const captcha = new OfficialWebSearchProvider({
    apiKey: 'synthetic-key',
    gate,
    client: {
      async scrape(url) {
        return { rawHtml: '<title>captcha</title>', metadata: { sourceURL: url, statusCode: 200 } }
      },
    },
  })
  await assert.rejects(
    () => captcha.fetchOfficialProductPage({ url: 'https://alter-web.jp/products/19002' }),
    (error) => error.category === 'captcha' && error.requestRecord.retries === 0,
  )

  let attempts = 0
  const fakeClock = clock()
  const retried = new OfficialWebSearchProvider({
    apiKey: 'synthetic-key',
    gate,
    client: {
      async search() {
        attempts += 1
        if (attempts < 3) throw Object.assign(new Error('temporary'), { status: 503 })
        return { web: [] }
      },
    },
    now: fakeClock.now,
    sleep: fakeClock.sleep,
  })
  const result = await retried.searchOfficialProducts('碧蓝航线 柴郡 手办')
  assert.equal(attempts, 3)
  assert.deepEqual(fakeClock.sleeps, [1000, 1000])
  assert.equal(result.requestRecord.retries, 2)
  assert.equal(result.requestRecord.creditUsage, 30)
})
