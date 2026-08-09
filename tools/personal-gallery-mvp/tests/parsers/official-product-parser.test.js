import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  OFFICIAL_PRODUCT_PARSER_VERSION,
  OfficialPageValidationError,
  parseOfficialProductPage,
} from '../../src/parsers/official-product-parser.js'

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const fixture = (name) => readFile(path.join(fixtures, name), 'utf8')

test('Good Smile parser returns official fields and only product-gallery images', async () => {
  const rawHtml = await fixture('goodsmile-product.synthetic.html')
  const product = parseOfficialProductPage({
    rawHtml,
    url: 'https://www.goodsmile.com/en/product/19001/cheshire-summery-date?ref=search',
    images: [
      'https://images.goodsmile.com/synthetic/cheshire-19001-01.jpg',
      'https://images.goodsmile.com/synthetic/related-product.jpg',
    ],
    discoveryQuery: '"Azur Lane" Cheshire figure',
  })

  assert.equal(product.sourceType, 'official')
  assert.equal(product.sourceKind, 'official_manufacturer')
  assert.equal(product.sourceDomain, 'goodsmile.com')
  assert.equal(product.discoveryMethod, 'firecrawl_search')
  assert.equal(product.officialProductId, 'GSC-SYN-19001')
  assert.match(product.title, /Cheshire/)
  assert.equal(product.series, 'Azur Lane')
  assert.equal(product.manufacturer, 'Good Smile Arts Shanghai')
  assert.equal(product.scale, '1/7')
  assert.equal(product.height, 'Approx. 260 mm')
  assert.equal(product.releaseDate, '2031-05')
  assert.equal(product.classification, 'likely_scale')
  assert.equal(product.parserVersion, OFFICIAL_PRODUCT_PARSER_VERSION)
  assert.equal(product.authenticity.accepted, true)
  assert.ok(product.imageUrls.length >= 4)
  assert.ok(product.imageUrls.length <= 10)
  assert.equal(product.imageUrls.some((url) => url.includes('jsonld-01')), true)
  assert.equal(product.imageUrls.some((url) => url.includes('related-product')), false)
})

test('ALTER parser reads Japanese specifications and the current bxslider gallery', async () => {
  const product = parseOfficialProductPage({
    rawHtml: await fixture('alter-product.synthetic.html'),
    url: 'https://www.alter-web.jp/products/19002/',
    discoveryMethod: 'seed_official_url',
  })

  assert.equal(product.sourceKind, 'official_manufacturer')
  assert.equal(product.sourceDomain, 'alter-web.jp')
  assert.equal(product.discoveryMethod, 'seed_official_url')
  assert.equal(product.officialProductId, 'ALT-SYN-19002')
  assert.equal(product.character, 'Cheshire')
  assert.equal(product.series, 'アズールレーン')
  assert.equal(product.manufacturer, 'ALTER')
  assert.equal(product.scale, '1/7')
  assert.equal(product.height, '約 280 mm')
  assert.equal(product.releaseDate, '2031年6月')
  assert.equal(product.price, '26,800円')
  assert.equal(product.classification, 'likely_scale')
  assert.ok(product.imageUrls.length >= 4)
  assert.equal(product.imageUrls.some((url) => url.includes('cheshire-19002-03')), true)
  assert.equal(product.imageUrls.some((url) => url.includes('recommended')), false)
})

test('reviewed APEX manufacturer and AmiAmi distributor pages preserve source roles and stable IDs', async () => {
  const apex = parseOfficialProductPage({
    rawHtml: await fixture('apex-cheshire.synthetic.html'),
    url: 'https://apex-toys.com/productinfo/3727461.html',
    discoveryMethod: 'seed_official_url',
  })
  assert.equal(apex.sourceKind, 'official_manufacturer')
  assert.equal(apex.sourceDomain, 'apex-toys.com')
  assert.equal(apex.manufacturer, 'APEX')
  assert.equal(apex.distributor, null)
  assert.equal(apex.officialProductId, '3727461')
  assert.equal(apex.scale, '1/8')
  assert.equal(apex.classification, 'likely_scale')
  assert.equal(apex.imageUrls.length, 2)

  const amiami = parseOfficialProductPage({
    rawHtml: await fixture('amiami-cheshire.synthetic.html'),
    url: 'https://www.amiami.jp/top/detail/detail?gcode=FIGURE-181336&utm_source=synthetic',
    discoveryMethod: 'seed_official_url',
  })
  assert.equal(amiami.sourceKind, 'official_distributor')
  assert.equal(amiami.sourceDomain, 'amiami.jp')
  assert.equal(amiami.manufacturer, 'あみあみ×AniGame')
  assert.equal(amiami.distributor, 'AmiAmi')
  assert.equal(amiami.officialProductId, 'FIGURE-181336')
  assert.equal(amiami.scale, '1/6')
  assert.equal(amiami.classification, 'likely_scale')
  assert.equal(amiami.imageUrls.length, 2)
  assert.equal(amiami.imageUrls.some((url) => url.includes('related-product')), false)
})

test('multiple JSON-LD Products select only the item matching the current canonical URL and title', async () => {
  const product = parseOfficialProductPage({
    rawHtml: await fixture('official-multiple-jsonld.synthetic.html'),
    url: 'https://www.goodsmile.com/en/product/19006/cheshire-current',
  })

  assert.equal(product.officialProductId, 'GSC-CURRENT-19006')
  assert.equal(product.title, 'Synthetic Cheshire Current Product')
  assert.equal(product.imageUrls.some((url) => url.includes('cheshire-current-jsonld')), true)
  assert.equal(product.imageUrls.some((url) => url.includes('belfast-related-jsonld')), false)
})

test('a lone unrelated JSON-LD Product cannot override a visible current-page title', async () => {
  const product = parseOfficialProductPage({
    rawHtml: await fixture('official-single-unrelated-jsonld.synthetic.html'),
    url: 'https://www.goodsmile.com/en/product/19007/cheshire-dom-product',
  })

  assert.equal(product.officialProductId, null)
  assert.equal(product.title, 'Synthetic Cheshire DOM Product')
  assert.equal(product.imageUrls.some((url) => url.includes('cheshire-dom-current')), true)
  assert.equal(product.imageUrls.some((url) => url.includes('belfast-unrelated-jsonld')), false)
})

test('related-product mentions cannot turn a different product into Cheshire', async () => {
  const rawHtml = await fixture('official-related-only.synthetic.html')
  assert.throws(
    () => parseOfficialProductPage({
      rawHtml,
      url: 'https://www.goodsmile.com/en/product/19004/belfast',
    }),
    (error) => error instanceof OfficialPageValidationError
      && error.evidence?.rejectedReason === 'character_not_in_primary_product_title',
  )
})

test('Nendoroid is retained as other while insufficient pages are rejected', async () => {
  const nendoroid = parseOfficialProductPage({
    rawHtml: await fixture('goodsmile-nendoroid.synthetic.html'),
    url: 'https://goodsmile.com/en/product/19003/nendoroid-cheshire',
  })
  assert.equal(nendoroid.classification, 'other')
  assert.equal(nendoroid.excludedReason, 'nendoroid')

  const missingFields = await fixture('official-missing-fields.synthetic.html')
  assert.throws(
    () => parseOfficialProductPage({
      rawHtml: missingFields,
      url: 'https://goodsmilearts.com/product/19005/cheshire-placeholder',
    }),
    (error) => error instanceof OfficialPageValidationError
      && error.evidence?.rejectedReason === 'insufficient_official_product_evidence',
  )
})

test('parser rejects unreviewed domains before inspecting content', async () => {
  const rawHtml = await fixture('goodsmile-product.synthetic.html')
  assert.throws(
    () => parseOfficialProductPage({
      rawHtml,
      url: 'https://example.test/product/19001',
    }),
    (error) => error instanceof OfficialPageValidationError && error.code === 'official_url_not_allowed',
  )
})
