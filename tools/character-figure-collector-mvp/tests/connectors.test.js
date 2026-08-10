import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProfile } from '../src/profiles.js'
import { parseGoodSmileCurrent, parseGoodSmileLegacy, parseLegacySearch } from '../src/connectors/goodsmile.js'
import { parseSolarisProduct } from '../src/connectors/solaris.js'
import { parseJapanFigureProduct } from '../src/connectors/japan-figure.js'

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
