import test from 'node:test'
import assert from 'node:assert/strict'
import { PolicyFetcher } from '../src/fetcher.js'
import { AccessBlockedError, assertAllowedUrl, robotsAllows } from '../src/network-policy.js'

test('Hpoi and unlisted hosts are hard denied before transport', async () => {
  let calls = 0
  const fetcher = new PolicyFetcher({ delayMs: 0, transport: async () => { calls += 1; return new Response('') } })
  await assert.rejects(fetcher.text('https://www.hpoi.net/product/1'), (error) => error instanceof AccessBlockedError && error.reason === 'hpoi_hard_denied')
  await assert.rejects(fetcher.text('https://example.com/product/1'), (error) => error instanceof AccessBlockedError && error.reason === 'host_not_allowlisted')
  assert.equal(calls, 0)
})

test('robots policy uses longest rule and fails closed on disallow', async () => {
  const robots = 'User-agent: *\nDisallow: /api/\nAllow: /api/public/'
  assert.equal(robotsAllows(robots, new URL('https://japan-figure.com/api/public/item')), true)
  assert.equal(robotsAllows(robots, new URL('https://japan-figure.com/api/private/item')), false)
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*?secret=*$', new URL('https://japan-figure.com/products/x?secret=1')), false)
  const transport = async (url) => url.pathname === '/robots.txt'
    ? new Response('User-agent: *\nDisallow: /products/private', { status: 200 })
    : new Response('ok', { status: 200 })
  const fetcher = new PolicyFetcher({ delayMs: 0, transport })
  await assert.rejects(fetcher.text('https://solarisjapan.com/products/private-item'), (error) => error instanceof AccessBlockedError && error.reason === 'robots_disallow')
})

for (const status of [401, 403, 429]) {
  test(`HTTP ${status} stops immediately`, async () => {
    let targetCalls = 0
    const transport = async (url) => {
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { status: 200 })
      targetCalls += 1
      return new Response('blocked', { status })
    }
    const fetcher = new PolicyFetcher({ delayMs: 0, transport })
    await assert.rejects(fetcher.text('https://www.goodsmile.com/en/product/1'), (error) => error instanceof AccessBlockedError && error.status === status)
    assert.equal(targetCalls, 1)
  })
}

test('redirects cannot escape the source allowlist', async () => {
  const transport = async (url) => url.pathname === '/robots.txt'
    ? new Response('User-agent: *\nAllow: /', { status: 200 })
    : new Response('', { status: 302, headers: { location: 'https://example.com/escape' } })
  const fetcher = new PolicyFetcher({ delayMs: 0, transport })
  await assert.rejects(fetcher.text('https://solarisjapan.com/products/item'), (error) => error instanceof AccessBlockedError && error.reason === 'host_not_allowlisted')
})

test('a 200 access challenge is still a hard stop', async () => {
  const transport = async (url) => url.pathname === '/robots.txt'
    ? new Response('User-agent: *\nAllow: /', { status: 200 })
    : new Response('<title>Verify you are human</title>', { status: 200 })
  const fetcher = new PolicyFetcher({ delayMs: 0, transport })
  await assert.rejects(fetcher.text('https://www.goodsmile.com/en/product/1'), (error) => error instanceof AccessBlockedError && error.reason === 'access_challenge')
})

test('allowlist accepts only reviewed HTTPS source hosts', () => {
  assert.equal(assertAllowedUrl('https://solarisjapan.com/collections/x/products.json').hostname, 'solarisjapan.com')
  assert.throws(() => assertAllowedUrl('http://solarisjapan.com/collections/x/products.json'), AccessBlockedError)
})
