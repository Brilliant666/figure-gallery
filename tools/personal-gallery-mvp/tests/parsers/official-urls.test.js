import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OFFICIAL_ALLOWED_PAGE_HOSTS,
  canonicalOfficialDomain,
  classifyOfficialSearchResult,
  isAllowedOfficialProductUrl,
  isHpoiHost,
  normalizeOfficialPageUrl,
  officialUrlIdentity,
  sanitizeUnreviewedSearchResultUrl,
} from '../../src/parsers/official-urls.js'

test('official URL allowlist is exact and Hpoi is always denied', () => {
  assert.deepEqual(OFFICIAL_ALLOWED_PAGE_HOSTS, [
    'goodsmile.com',
    'www.goodsmile.com',
    'goodsmilearts.com',
    'www.goodsmilearts.com',
    'alter-web.jp',
    'www.alter-web.jp',
  ])
  for (const host of OFFICIAL_ALLOWED_PAGE_HOSTS) {
    assert.equal(isAllowedOfficialProductUrl(`https://${host}/products/synthetic-1`), true)
  }
  assert.equal(isHpoiHost('hpoi.net'), true)
  assert.equal(isHpoiHost('www.hpoi.net'), true)
  assert.equal(isHpoiHost('cache.hpoi.net'), true)
  assert.equal(isHpoiHost('hpoi.net.cn'), true)
  assert.equal(isHpoiHost('img.hpoi.net.cn'), true)
  assert.equal(classifyOfficialSearchResult('https://www.hpoi.net/hobby/1').status, 'hpoi_denied')
  assert.equal(classifyOfficialSearchResult('https://img.hpoi.net.cn/hobby/1').status, 'hpoi_denied')
  assert.equal(classifyOfficialSearchResult('https://mirror.example/hpoi/1').status, 'unreviewed_domain')
})

test('unreviewed search-result URLs cannot persist credentials, sensitive query values, or tracking fragments', () => {
  assert.equal(
    sanitizeUnreviewedSearchResultUrl(
      'https://catalog.example.test/item?token=secret&utm_source=search&locale=ja#session-secret',
    ),
    'https://catalog.example.test/item',
  )
  const classified = classifyOfficialSearchResult(
    'https://catalog.example.test/item?session=private&locale=en#authorization',
  )
  assert.equal(classified.status, 'unreviewed_domain')
  assert.equal(classified.url, 'https://catalog.example.test/item')
  assert.equal(
    sanitizeUnreviewedSearchResultUrl('https://catalog.example.test/item?unknown_signed_value=private'),
    'https://catalog.example.test/item',
  )
  assert.equal(sanitizeUnreviewedSearchResultUrl('https://user:secret@catalog.example.test/item'), null)
})

test('official URL normalization removes tracking without weakening credential or page checks', () => {
  assert.equal(
    normalizeOfficialPageUrl('https://www.goodsmile.com/en/product/1/?utm_source=test&b=2&a=1#gallery'),
    'https://www.goodsmile.com/en/product/1?a=1&b=2',
  )
  assert.equal(normalizeOfficialPageUrl('https://user:secret@www.goodsmile.com/en/product/1'), null)
  assert.equal(normalizeOfficialPageUrl('https://www.goodsmile.com/en/product/1?token=secret'), null)
  assert.equal(normalizeOfficialPageUrl('http://www.goodsmile.com/en/product/1'), null)
  assert.equal(isAllowedOfficialProductUrl('https://www.goodsmile.com/search?q=cheshire'), false)
  assert.equal(isAllowedOfficialProductUrl('https://alter-web.jp/news/cheshire'), false)
  assert.equal(isAllowedOfficialProductUrl('https://evil.goodsmile.com/product/1'), false)
})

test('official identities collapse reviewed www aliases but preserve an executable URL', () => {
  assert.equal(canonicalOfficialDomain('www.goodsmile.com'), 'goodsmile.com')
  assert.equal(
    officialUrlIdentity('https://www.goodsmile.com/en/product/1/?utm_source=x'),
    officialUrlIdentity('https://goodsmile.com/en/product/1'),
  )
  assert.equal(
    normalizeOfficialPageUrl('https://www.goodsmile.com/en/product/1'),
    'https://www.goodsmile.com/en/product/1',
  )
})
