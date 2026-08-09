import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  classifyProduct,
  HPOI_PRODUCT_PARSER_VERSION,
  parseProductPage,
} from '../../src/parsers/product-parser.js'

const fixture = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

test('current item structure and recursive JSON-LD produce deterministic fields', async () => {
  const rawHtml = await fixture('product-current.synthetic.html')
  const result = parseProductPage({
    rawHtml,
    url: 'https://www.hpoi.net/hobby/999999911?ref=fixture',
    images: [
      'https://images.example.test/gk/pic/synthetic-b.jpg',
      'https://images.example.test/static/banner/promo.jpg',
    ],
    parsedAt: '2031-01-02T03:04:05.000Z',
  })

  assert.equal(result.hpoiProductId, '999999911')
  assert.equal(result.sourceUrl, 'https://www.hpoi.net/hobby/999999911')
  assert.equal(result.title, '柴郡 合成礼服版')
  assert.deepEqual(result.characterNames, ['柴郡', '合成伙伴'])
  assert.equal(result.workName, '合成作品甲')
  assert.equal(result.manufacturer, '合成制造社')
  assert.equal(result.rawCategory, '比例手办')
  assert.equal(result.rawScale, '1 / 7')
  assert.equal(result.releaseStatus, '预售')
  assert.equal(result.releaseDate, '2030 年 8 月')
  assert.equal(result.versionNotes, '合成测试版')
  assert.equal(result.classification, 'likely_scale')
  assert.equal(result.homepageImage, 'https://images.example.test/gk/cover/synthetic-main.png')
  assert.ok(result.imageUrls.includes('https://images.example.test/gk/pic/synthetic-b.jpg'))
  assert.ok(result.imageUrls.includes('https://images.example.test/gk/pic/synthetic-c-large.png'))
  assert.ok(result.imageUrls.every((url) => !/avatar|favicon|banner/.test(url)))
  assert.deepEqual(result.discoveredImageHosts, ['images.example.test'])
  assert.deepEqual(result.needsReview, [])
  assert.equal(result.parserVersion, HPOI_PRODUCT_PARSER_VERSION)
  assert.equal(result.parsedAt, '2031-01-02T03:04:05.000Z')
})

test('legacy dt/dd fields remain supported and a missing scale is flagged for review', async () => {
  const rawHtml = await fixture('product-legacy.synthetic.html')
  const result = parseProductPage({
    rawHtml,
    url: 'https://www.hpoi.net/move/hobby/999999912',
    parsedAt: '2031-01-02T03:04:05.000Z',
  })

  assert.equal(result.title, '柴郡 合成景品')
  assert.equal(result.manufacturer, '合成景品厂')
  assert.equal(result.classification, 'likely_prize')
  assert.equal(result.homepageImage, 'https://cdn.example.test/gk/cover/synthetic-prize.jpg')
  assert.ok(result.needsReview.includes('rawScale'))
  assert.ok(!result.parserWarnings.includes('known_field_structure_missing'))
})

test('unknown DOM and malformed structured data are reported without guessed fields', async () => {
  const rawHtml = await fixture('product-missing.synthetic.html')
  const result = parseProductPage({
    rawHtml,
    url: 'https://www.hpoi.net/hobby/999999913',
    parsedAt: '2031-01-02T03:04:05.000Z',
  })

  assert.equal(result.title, '只有标题的合成商品')
  assert.equal(result.manufacturer, null)
  assert.equal(result.rawCategory, null)
  assert.equal(result.classification, 'unknown')
  assert.ok(result.needsReview.includes('manufacturer'))
  assert.ok(result.needsReview.includes('classification'))
  assert.ok(result.parserWarnings.includes('invalid_json_ld'))
  assert.ok(result.parserWarnings.includes('known_field_structure_missing'))
  assert.ok(result.parserWarnings.includes('product_images_missing'))
})

test('Firecrawl product output is auxiliary fallback and never replaces the URL stable ID', () => {
  const result = parseProductPage({
    rawHtml: '<html data-fixture="synthetic"><body><div>changed layout</div></body></html>',
    url: 'https://www.hpoi.net/hobby/999999914',
    firecrawlProduct: {
      title: 'Firecrawl 合成辅助标题',
      brand: '辅助厂商',
      category: '景品',
      variants: [{
        availability: { inStock: true, text: '可用' },
        images: [{ url: 'https://images.example.test/gk/pic/firecrawl-helper.png', alt: '合成图' }],
      }],
    },
    images: ['https://images.example.test/gk/pic/firecrawl-helper.png'],
    parsedAt: '2031-01-02T03:04:05.000Z',
  })
  assert.equal(result.hpoiProductId, '999999914')
  assert.equal(result.title, 'Firecrawl 合成辅助标题')
  assert.equal(result.manufacturer, '辅助厂商')
  assert.equal(result.releaseStatus, '可用')
  assert.equal(result.classification, 'likely_prize')
  assert.deepEqual(result.imageUrls, ['https://images.example.test/gk/pic/firecrawl-helper.png'])
})

test('auxiliary product image URLs require corroboration from the page images result', () => {
  const result = parseProductPage({
    rawHtml: '<html data-fixture="synthetic"><body><div>changed layout</div></body></html>',
    url: 'https://www.hpoi.net/hobby/999999915',
    firecrawlProduct: {
      title: 'Synthetic helper title',
      images: ['https://images.example.test/gk/pic/uncorroborated.png'],
    },
    images: [],
    parsedAt: '2031-01-02T03:04:05.000Z',
  })
  assert.deepEqual(result.imageUrls, [])
  assert.ok(result.parserWarnings.includes('product_images_missing'))
})

test('credential-bearing image URLs are never emitted by the deterministic parser', () => {
  const result = parseProductPage({
    rawHtml: '<html data-fixture="synthetic"><body><img src="https://user:synthetic-secret@images.example.test/private.png"><img src="https://images.example.test/private.png?access_token=synthetic-secret"></body></html>',
    url: 'https://www.hpoi.net/hobby/999999916',
    parsedAt: '2031-01-02T03:04:05.000Z',
  })
  assert.deepEqual(result.imageUrls, [])
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false)
})

test('classification preserves uncertainty and excludes only explicit non-target categories', () => {
  assert.deepEqual(classifyProduct({ title: '普通手办', rawCategory: null, rawScale: null }), {
    classification: 'unknown',
    excludedReason: null,
  })
  assert.equal(classifyProduct({ title: '合成测试', rawCategory: '1/8 比例', rawScale: null }).classification, 'likely_scale')
  assert.equal(classifyProduct({ title: '合成景品', rawCategory: null, rawScale: null }).classification, 'likely_prize')
  assert.deepEqual(classifyProduct({ title: '合成测试', rawCategory: '未授权 GK', rawScale: '1/7' }), {
    classification: 'other',
    excludedReason: 'unauthorized_gk',
  })
  assert.equal(classifyProduct({ title: '黏土人 合成版', rawCategory: null, rawScale: null }).classification, 'other')
})

test('classification recognizes public non-scale completed figures without calling them prizes', () => {
  assert.deepEqual(classifyProduct({
    title: 'POP UP PARADE Rem L Size',
    rawCategory: 'Painted plastic non-scale complete product',
  }), { classification: 'likely_static', excludedReason: null })
})

test('product parser rejects non-allowlisted page URLs', () => {
  assert.throws(
    () => parseProductPage({ rawHtml: '<title>x</title>', url: 'https://example.test/hobby/1' }),
    /not an allowed Hpoi product URL/,
  )
})
