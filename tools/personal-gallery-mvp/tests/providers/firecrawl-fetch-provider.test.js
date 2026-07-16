import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import test from 'node:test'

import {
  FIRECRAWL_ALLOWED_METHODS,
  FirecrawlFetchProvider,
  ProviderBlockedError,
  ProviderRequestError,
} from '../../src/providers/firecrawl-fetch-provider.js'

const allowedGate = Object.freeze({ allowed: true, missing: [] })

test('official SDK transport is configured for one attempt while provider owns retries', () => {
  const options = []
  new FirecrawlFetchProvider({
    apiKey: 'synthetic-test-key',
    gate: allowedGate,
    clientFactory(value) {
      options.push(value)
      return { scrape: async () => assert.fail('constructor must not issue a request') }
    },
  })
  assert.deepEqual(options, [{
    apiKey: 'synthetic-test-key',
    apiUrl: 'https://api.firecrawl.dev',
    maxRetries: 1,
  }])
})

test('pinned official SDK performs one loopback transport attempt for one provider attempt', async (t) => {
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
        rawHtml: '<main>synthetic SDK transport</main>',
        links: [],
        images: [],
        metadata: {
          sourceURL: 'https://www.hpoi.net/hobby/999999911',
          statusCode: 200,
          creditsUsed: 1,
        },
      },
    }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.close()
    await once(server, 'close')
  })

  const address = server.address()
  const provider = new FirecrawlFetchProvider({
    apiKey: 'synthetic-test-key',
    apiUrl: `http://127.0.0.1:${address.port}`,
    gate: allowedGate,
    maxRetries: 0,
  })
  const result = await provider.scrape('https://www.hpoi.net/hobby/999999911')
  assert.equal(result.rawHtml, '<main>synthetic SDK transport</main>')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].path, '/v2/scrape')
  assert.equal(requests[0].body.url, 'https://www.hpoi.net/hobby/999999911')
})

function fakeClock() {
  let value = Date.parse('2031-01-02T03:04:05.000Z')
  const sleeps = []
  return {
    now: () => value,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
      value += milliseconds
    },
    sleeps,
  }
}

test('scrape uses only standard rawHtml/links/images/product formats and emits a safe request record', async () => {
  const calls = []
  const logs = []
  const client = {
    scrape: async (...args) => {
      calls.push(args)
      return {
        rawHtml: '<main>synthetic</main>',
        links: ['/hobby/999999911'],
        images: ['https://images.example.test/synthetic.png'],
        product: { name: '合成商品' },
        metadata: {
          sourceURL: 'https://www.hpoi.net/hobby/999999911',
          statusCode: 200,
          creditsUsed: 1,
        },
      }
    },
  }
  const clock = fakeClock()
  const provider = new FirecrawlFetchProvider({
    apiKey: 'secret-for-test',
    client,
    gate: allowedGate,
    logger: (entry) => logs.push(entry),
    now: clock.now,
    sleep: clock.sleep,
  })

  const result = await provider.scrape('https://hpoi.net/hobby/999999911?utm_source=x', {
    requestType: 'product',
    includeProduct: true,
  })

  assert.deepEqual(calls, [[
    'https://www.hpoi.net/hobby/999999911',
    { formats: ['rawHtml', 'links', 'images', 'product'] },
  ]])
  assert.equal(result.product.name, '合成商品')
  assert.equal(result.requestRecord.firecrawlSuccess, true)
  assert.equal(result.requestRecord.creditUsage, 1)
  assert.equal(result.requestRecord.creditUsageKind, 'reported')
  assert.equal(result.requestRecord.requestType, 'product')
  assert.deepEqual(logs, [result.requestRecord])
  assert.ok(!JSON.stringify(logs).includes('secret-for-test'))
  assert.deepEqual(FIRECRAWL_ALLOWED_METHODS, ['scrape', 'search'])
})

test('search is domain-limited and returns only Hpoi character URLs', async () => {
  const calls = []
  const client = {
    search: async (...args) => {
      calls.push(args)
      return {
        web: [
          { title: '柴郡', url: 'https://www.hpoi.net/charactar/999999901' },
          { title: 'outside', url: 'https://example.test/charactar/1' },
          { title: 'product', url: 'https://www.hpoi.net/hobby/999999911' },
        ],
      }
    },
  }
  const provider = new FirecrawlFetchProvider({ apiKey: 'test', client, gate: allowedGate })
  const result = await provider.searchCharacters('柴郡', { limit: 3 })

  assert.deepEqual(calls, [[
    '柴郡 site:hpoi.net/charactar/',
    { sources: ['web'], includeDomains: ['hpoi.net'], limit: 3 },
  ]])
  assert.deepEqual(result.web.map((entry) => entry.url), ['https://www.hpoi.net/charactar/999999901'])
  assert.equal(result.requestRecord.creditUsage, 3)
  assert.equal(result.requestRecord.creditUsageKind, 'estimated_upper_bound')
})

test('collector adapters map discovery and page fetches without adding a provider mode', async () => {
  const calls = []
  const client = {
    search: async (...args) => {
      calls.push(['search', ...args])
      return { web: [{ title: '柴郡', workName: '合成作品甲', url: 'https://hpoi.net/charactar/999999901' }] }
    },
    scrape: async (url, options) => {
      calls.push(['scrape', url, options])
      return {
        rawHtml: `<main data-url="${url}">synthetic</main>`,
        links: [`${url}?fixture=link`],
        images: ['https://images.example.test/synthetic.png'],
        product: options.formats.includes('product') ? { title: '合成商品' } : undefined,
        metadata: { statusCode: 200, sourceURL: url, creditsUsed: 1 },
      }
    },
  }
  const provider = new FirecrawlFetchProvider({
    apiKey: 'test',
    client,
    gate: allowedGate,
    now: () => Date.parse('2031-01-02T03:04:05.000Z'),
    sleep: async () => {},
  })

  const discovery = await provider.discoverCharacter({ query: '柴郡' })
  assert.equal(discovery.status, 'matched')
  assert.deepEqual(discovery.candidates, [{
    title: '柴郡',
    work: '合成作品甲',
    workName: '合成作品甲',
    url: 'https://www.hpoi.net/charactar/999999901',
    confidence: 'high',
    highConfidence: true,
  }])
  assert.equal(discovery.requestRecord.requestType, 'search')

  const character = await provider.fetchCharacterPage({ url: discovery.candidates[0].url })
  assert.equal(character.status, 200)
  assert.equal(character.finalUrl, 'https://www.hpoi.net/charactar/999999901')
  assert.equal(character.product, null)
  assert.equal(character.requestRecord.requestType, 'character')

  const product = await provider.fetchProductPage({ url: 'https://www.hpoi.net/hobby/999999911' })
  assert.equal(product.status, 200)
  assert.equal(product.finalUrl, 'https://www.hpoi.net/hobby/999999911')
  assert.equal(product.product.title, '合成商品')
  assert.equal(product.requestRecord.requestType, 'product')

  assert.deepEqual(calls.map((call) => call[0]), ['search', 'scrape', 'scrape'])
  assert.deepEqual(calls[1][2], { formats: ['rawHtml', 'links', 'images'] })
  assert.deepEqual(calls[2][2], { formats: ['rawHtml', 'links', 'images', 'product'] })
})

test('collector adapters honor an already-aborted signal before any SDK method', async () => {
  let calls = 0
  const client = {
    search: async () => { calls += 1 },
    scrape: async () => { calls += 1 },
  }
  const provider = new FirecrawlFetchProvider({ apiKey: 'test', client, gate: allowedGate })
  const controller = new AbortController()
  controller.abort(new DOMException('stopped by test', 'AbortError'))

  await assert.rejects(() => provider.discoverCharacter({ query: '柴郡', signal: controller.signal }), { name: 'AbortError' })
  await assert.rejects(() => provider.fetchCharacterPage({ url: 'https://www.hpoi.net/charactar/999999901', signal: controller.signal }), { name: 'AbortError' })
  await assert.rejects(() => provider.fetchProductPage({ url: 'https://www.hpoi.net/hobby/999999911', signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 0)
})

test('an in-flight SDK request keeps the run occupied until the physical request settles', async () => {
  let release
  let calls = 0
  const logs = []
  const client = {
    scrape: async () => {
      calls += 1
      return new Promise((resolve) => { release = resolve })
    },
  }
  const provider = new FirecrawlFetchProvider({
    apiKey: 'test',
    client,
    gate: allowedGate,
    logger: (record) => logs.push(record),
  })
  const controller = new AbortController()
  const request = provider.fetchProductPage({
    url: 'https://www.hpoi.net/hobby/999999911',
    signal: controller.signal,
  })
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort(new DOMException('stopped by test', 'AbortError'))
  assert.equal(calls, 1)
  let settled = false
  request.finally(() => { settled = true }).catch(() => {})
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  assert.equal(logs.length, 0)

  // Once the synthetic physical transport settles, the aborted run records
  // the stop and performs no retry or response persistence.
  release({
    rawHtml: '<main>late synthetic response</main>',
    metadata: { statusCode: 200, sourceURL: 'https://www.hpoi.net/hobby/999999911' },
  })
  await assert.rejects(() => request, { name: 'AbortError' })
  assert.equal(settled, true)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].failureCategory, 'user_abort')
  assert.equal(logs[0].retries, 0)
})

test('closed live gate and non-allowlisted targets fail before the client is called', async () => {
  let calls = 0
  const client = { scrape: async () => { calls += 1 } }
  const closed = new FirecrawlFetchProvider({ apiKey: 'test', client })
  await assert.rejects(() => closed.scrape('https://www.hpoi.net/hobby/999999911'), (error) => {
    assert.equal(error.category, 'live_gate_closed')
    return true
  })
  const open = new FirecrawlFetchProvider({ apiKey: 'test', client, gate: allowedGate })
  await assert.rejects(() => open.scrape('https://example.test/hobby/1'), (error) => {
    assert.equal(error.category, 'url_not_allowed')
    return true
  })
  await assert.rejects(() => open.scrape('https://www.hpoi.net/login'), (error) => {
    assert.equal(error.category, 'url_not_allowed')
    return true
  })
  assert.equal(calls, 0)
})

for (const status of [401, 403, 429]) {
  test(`HTTP ${status} is a terminal block with no retry`, async () => {
    let calls = 0
    const client = {
      scrape: async () => {
        calls += 1
        throw Object.assign(new Error(`HTTP ${status}`), { status })
      },
    }
    const provider = new FirecrawlFetchProvider({ apiKey: 'test', client, gate: allowedGate })
    await assert.rejects(() => provider.scrape('https://www.hpoi.net/hobby/999999911'), (error) => {
      assert.ok(error instanceof ProviderBlockedError)
      assert.equal(error.category, `http_${status}`)
      assert.equal(error.requestRecord.retries, 0)
      return true
    })
    assert.equal(calls, 1)
  })
}

test('a resolved Firecrawl document with HTTP 403 metadata is also terminal', async () => {
  const client = {
    scrape: async () => ({
      rawHtml: '<main>blocked</main>',
      metadata: { statusCode: 403, sourceURL: 'https://www.hpoi.net/hobby/999999911' },
    }),
  }
  const provider = new FirecrawlFetchProvider({ apiKey: 'test', client, gate: allowedGate })
  await assert.rejects(() => provider.scrape('https://www.hpoi.net/hobby/999999911'), (error) => {
    assert.equal(error.category, 'http_403')
    assert.equal(error.requestRecord.retries, 0)
    return true
  })
})

test('blocked redirect metadata is credential-redacted before request logging', async () => {
  const secret = 'synthetic-provider-secret'
  const client = {
    scrape: async () => ({
      rawHtml: '<main>synthetic blocked redirect</main>',
      metadata: {
        statusCode: 200,
        sourceURL: `https://user:${secret}@www.hpoi.net/login?token=${secret}&page=1`,
      },
    }),
  }
  const provider = new FirecrawlFetchProvider({ apiKey: 'test', client, gate: allowedGate })
  await assert.rejects(() => provider.scrape('https://www.hpoi.net/hobby/999999911'), (error) => {
    assert.equal(error.category, 'redirect_outside_allowlist')
    assert.equal(error.requestRecord.finalSourceUrl, 'https://www.hpoi.net/login?page=1')
    assert.equal(JSON.stringify(error.requestRecord).includes(secret), false)
    return true
  })
})

test('captcha, robot verification, access denied, login, robots refusal, and outside redirect documents stop immediately', async (t) => {
  const cases = [
    ['captcha', { rawHtml: '<title>captcha</title>', metadata: { statusCode: 200, sourceURL: 'https://www.hpoi.net/hobby/999999911' } }],
    ['robot_verification', { rawHtml: '<title>Robot verification</title><p>Verify that you are a human</p>', metadata: { statusCode: 200, sourceURL: 'https://www.hpoi.net/hobby/999999911' } }],
    ['access_denied', { rawHtml: '<title>Access denied</title>', metadata: { statusCode: 200, sourceURL: 'https://www.hpoi.net/hobby/999999911' } }],
    ['login_required', { rawHtml: '<p>请先登录</p>', metadata: { statusCode: 200, sourceURL: 'https://www.hpoi.net/hobby/999999911' } }],
    ['robots_denied', { rawHtml: '', metadata: { statusCode: 200, sourceURL: 'https://www.hpoi.net/hobby/999999911', error: 'robots.txt disallows crawling' } }],
    ['redirect_outside_allowlist', { rawHtml: '<main>x</main>', metadata: { statusCode: 200, sourceURL: 'https://example.test/blocked' } }],
    ['redirect_outside_allowlist', { rawHtml: '<main>x</main>', metadata: { statusCode: 200, sourceURL: 'https://www.hpoi.net/login' } }],
  ]
  for (const [expectedCategory, response] of cases) {
    await t.test(expectedCategory, async () => {
      let calls = 0
      const client = { scrape: async () => { calls += 1; return response } }
      const provider = new FirecrawlFetchProvider({ apiKey: 'test', client, gate: allowedGate })
      await assert.rejects(() => provider.scrape('https://www.hpoi.net/hobby/999999911'), (error) => {
        assert.equal(error.category, expectedCategory)
        return true
      })
      assert.equal(calls, 1)
    })
  }
})

test('retryable failures respect delay and the two-retry ceiling', async () => {
  let calls = 0
  const client = {
    scrape: async () => {
      calls += 1
      if (calls < 3) throw Object.assign(new Error('temporary'), { status: 503 })
      return { rawHtml: '<main>ok</main>', metadata: { statusCode: 200, sourceURL: 'https://www.hpoi.net/hobby/999999911' } }
    },
  }
  const clock = fakeClock()
  const provider = new FirecrawlFetchProvider({
    apiKey: 'test',
    client,
    gate: allowedGate,
    now: clock.now,
    sleep: clock.sleep,
  })
  const result = await provider.scrape('https://www.hpoi.net/hobby/999999911')
  assert.equal(calls, 3)
  assert.deepEqual(clock.sleeps, [1500, 1500])
  assert.equal(result.requestRecord.retries, 2)
  assert.equal(result.requestRecord.creditUsage, 3)
  assert.equal(result.requestRecord.creditUsageKind, 'estimated_upper_bound')
})

test('terminal SDK errors redact API keys and authorization values', async () => {
  const apiKey = 'synthetic-secret-test-value'
  const client = {
    scrape: async () => {
      throw new Error(`api_key=${apiKey} Authorization: Bearer token-value`)
    },
  }
  const provider = new FirecrawlFetchProvider({ apiKey, client, gate: allowedGate, maxRetries: 0 })
  await assert.rejects(() => provider.scrape('https://www.hpoi.net/hobby/999999911'), (error) => {
    assert.ok(error instanceof ProviderRequestError)
    assert.ok(!error.message.includes(apiKey))
    assert.ok(!error.message.includes('token-value'))
    assert.match(error.message, /REDACTED/)
    return true
  })
})
