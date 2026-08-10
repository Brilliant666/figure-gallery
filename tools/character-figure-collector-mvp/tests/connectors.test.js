import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProfile } from '../src/profiles.js'
import { parseGoodSmileCurrent, parseGoodSmileLegacy, parseLegacySearch } from '../src/connectors/goodsmile.js'
import { parseSolarisProduct } from '../src/connectors/solaris.js'
import { collectJapanFigure, JapanFigurePaginationError, parseJapanFigureProduct } from '../src/connectors/japan-figure.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFile(path.join(HERE, 'fixtures', name), 'utf8')

test('Good Smile current and legacy parsers are profile-driven', async () => {
  const cheshire = resolveProfile('cheshire')
  const current = parseGoodSmileCurrent(await fixture('goodsmile-current.html'), 'https://www.goodsmile.com/en/product/36232/example', cheshire)
  assert.equal(current.record.characterSlug, 'cheshire')
  assert.equal(current.record.title, 'Cheshire Summery Date')
  assert.equal(current.record.manufacturer, 'Good Smile Arts Shanghai')
  assert.equal(current.record.scale, '1/7')
  assert.equal(current.record.heightMm, 260)
  assert.equal(current.record.images.length, 2)
  assert.deepEqual(current.related, ['https://www.goodsmile.com/en/product/36234'])

  const rem = resolveProfile('rem')
  const legacy = parseGoodSmileLegacy(await fixture('goodsmile-legacy.html'), 'https://www.goodsmile.info/en/product/4067/example', rem)
  assert.equal(legacy.characterSlug, 'rem')
  assert.equal(legacy.title, 'Rem Wedding Ver.')
  assert.equal(legacy.images.length, 1)
  const search = parseLegacySearch(await fixture('goodsmile-search.html'), 'https://www.goodsmile.info/en/products/search', rem)
  assert.deepEqual(search.links, ['https://www.goodsmile.info/en/product/4067'])
  assert.equal(search.hasNext, true)
})

test('Solaris and Japan Figure records share the lightweight record contract', () => {
  const profile = resolveProfile('cheshire')
  const solaris = parseSolarisProduct({
    id: 42,
    title: 'Azur Lane - Cheshire - 1/7 Figure',
    handle: 'azur-lane-cheshire',
    vendor: 'Good Smile Company',
    product_type: 'Figure',
    tags: ['meta-type-General'],
    body_html: '<p>Approximately 250 mm in height.</p>',
    images: [{ src: 'https://cdn.example.test/cheshire.jpg' }],
    variants: [{ available: true }],
  }, profile)
  assert.equal(solaris.sourceRefs[0].family, 'solaris')
  assert.equal(solaris.scale, '1/7')
  assert.equal(solaris.heightMm, 250)

  const japan = parseJapanFigureProduct({
    id: 'gid://shopify/Product/99',
    title: 'Azur Lane Cheshire Prize Figure',
    url: 'https://japan-figure.com/products/cheshire',
    tags: ['brand_Taito', 'Prize'],
    description: { html: '<p>180 mm</p>' },
    media: [{ type: 'image', url: 'https://cdn.example.test/jf.jpg' }],
    variants: [],
  }, profile)
  assert.equal(japan.sourceRefs[0].family, 'japan-figure')
  assert.equal(japan.manufacturer, 'Taito')
  assert.equal(japan.category, 'Prize')
})

test('Japan Figure extracts an explicitly labelled manufacturer from public product text', () => {
  const profile = resolveProfile('cheshire')
  const item = parseJapanFigureProduct({
    id: 'gid://shopify/Product/100',
    title: 'Apex Azure Lane Cheshire Date Summer Figure 1/8 Scale PVC ABS',
    url: 'https://japan-figure.com/products/cheshire-date-summer',
    tags: ['Statues'],
    description: { html: '<p>Product Material: PVC/ABS • Manufacturer: APEX • Release Date: 2026-07-31</p>' },
    media: [],
    variants: [],
  }, profile)
  assert.equal(item.manufacturer, 'APEX')
})

function responsePage(products, hasNextPage, cursor = null) {
  return { result: { structuredContent: { products, pagination: { has_next_page: hasNextPage, cursor } } } }
}

function product(id) {
  return { id: `gid://shopify/Product/${id}`, title: `Azur Lane Cheshire Figure ${id}`, url: `https://japan-figure.com/products/${id.toLowerCase()}` }
}

function fixtureFetcher(pages) {
  const requests = []
  return {
    requests,
    async postJson(url, payload) {
      requests.push({ url, payload })
      if (!pages.length) throw new Error('Unexpected Japan Figure fixture request.')
      return pages.shift()
    },
  }
}

test('Japan Figure follows three cursor pages until explicit source exhaustion', async () => {
  const profile = resolveProfile('cheshire')
  const payload = JSON.parse(await fixture('japan-figure-pagination.json'))
  const fetcher = fixtureFetcher(structuredClone(payload.pages))
  const result = await collectJapanFigure(fetcher, profile)
  assert.deepEqual(result.records.map((item) => item.sourceRefs[0].sourceId), ['A', 'B', 'C', 'D', 'E'])
  assert.equal(result.raw, 5)
  assert.deepEqual(result.pagination, {
    status: 'PASS',
    strategy: 'cursor',
    pagesFetched: 3,
    recordsFetchedRaw: 5,
    uniqueSourceRecords: 5,
    duplicateSourceRecords: 0,
    paginationExhausted: true,
    terminationReason: 'source_exhausted',
    finalCursorState: 'absent',
  })
  assert.equal(fetcher.requests[0].payload.params.arguments.catalog.pagination.cursor, undefined)
  assert.equal(fetcher.requests[1].payload.params.arguments.catalog.pagination.cursor, 'C2')
  assert.equal(fetcher.requests[2].payload.params.arguments.catalog.pagination.cursor, 'C3')
})

test('Japan Figure deduplicates the same source product across cursor pages', async () => {
  const profile = resolveProfile('cheshire')
  const fetcher = fixtureFetcher([
    responsePage([product('A'), product('B')], true, 'C2'),
    responsePage([product('B'), product('C')], false),
  ])
  const result = await collectJapanFigure(fetcher, profile)
  assert.deepEqual(result.records.map((item) => item.sourceRefs[0].sourceId), ['A', 'B', 'C'])
  assert.equal(result.pagination.recordsFetchedRaw, 4)
  assert.equal(result.pagination.uniqueSourceRecords, 3)
  assert.equal(result.pagination.duplicateSourceRecords, 1)
})

test('Japan Figure rejects a repeated current cursor', async () => {
  const fetcher = fixtureFetcher([
    responsePage([product('A')], true, 'C2'),
    responsePage([product('B')], true, 'C2'),
  ])
  await assert.rejects(collectJapanFigure(fetcher, resolveProfile('cheshire')), (error) => {
    assert.ok(error instanceof JapanFigurePaginationError)
    assert.equal(error.code, 'same_cursor')
    assert.equal(error.status, 'ERROR')
    assert.equal(error.paginationEvidence.pagesFetched, 2)
    return true
  })
})

test('Japan Figure rejects a cursor cycle', async () => {
  const fetcher = fixtureFetcher([
    responsePage([product('A')], true, 'C2'),
    responsePage([product('B')], true, 'C3'),
    responsePage([product('C')], true, 'C2'),
  ])
  await assert.rejects(collectJapanFigure(fetcher, resolveProfile('cheshire')), (error) => {
    assert.ok(error instanceof JapanFigurePaginationError)
    assert.equal(error.code, 'cursor_cycle')
    assert.equal(error.status, 'ERROR')
    assert.equal(error.paginationEvidence.paginationExhausted, false)
    return true
  })
})

test('Japan Figure reports an incomplete result when the safety cap is reached', async () => {
  const fetcher = fixtureFetcher([
    responsePage([product('A')], true, 'C2'),
    responsePage([product('B')], true, 'C3'),
  ])
  await assert.rejects(collectJapanFigure(fetcher, resolveProfile('cheshire'), { maxPages: 2 }), (error) => {
    assert.ok(error instanceof JapanFigurePaginationError)
    assert.equal(error.code, 'safety_cap')
    assert.equal(error.status, 'INCOMPLETE')
    assert.equal(error.paginationEvidence.pagesFetched, 2)
    assert.equal(error.paginationEvidence.terminationReason, 'safety_cap')
    return true
  })
})

test('Japan Figure fails closed when next-page metadata omits the cursor', async () => {
  const fetcher = fixtureFetcher([responsePage([product('A')], true)])
  await assert.rejects(collectJapanFigure(fetcher, resolveProfile('cheshire')), (error) => {
    assert.ok(error instanceof JapanFigurePaginationError)
    assert.equal(error.code, 'protocol_error')
    assert.equal(error.status, 'ERROR')
    return true
  })
})
