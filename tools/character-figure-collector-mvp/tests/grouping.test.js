import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProjectionInput, buildReviewTemplate, produceGrouping } from '../src/grouping.js'
import { resolveProfile } from '../src/profiles.js'
import { record } from '../src/records.js'
import { mergeCatalog } from '../src/catalog.js'

function item(id, title, { scale = '1/7', manufacturer = 'Taito' } = {}) {
  const source = record({
    sourceFamily: 'solaris',
    sourceId: id,
    sourceUrl: `https://solarisjapan.com/products/${id}`,
    character: resolveProfile('cheshire'),
    title,
    series: 'Azur Lane',
    manufacturer,
    category: 'Prize',
    scale,
    imageUrls: [`https://cdn.example.test/${id}.jpg`],
  })
  return mergeCatalog([], [source], '2026-08-10T00:00:00.000Z').items[0]
}

test('generic text-first grouping emits auto, review, and keep-separate relations', () => {
  const profile = resolveProfile('cheshire')
  const items = [
    item('normal', 'Cheshire Summer Pose'),
    item('color', 'Cheshire Summer Pose Special Color'),
    item('bunny', 'Cheshire Bunny'),
    item('bunny-2nd', 'Cheshire Bunny 2nd'),
    item('similar', 'Cheshire Summer Pose Deluxe Accessory'),
  ]
  const result = produceGrouping(items, profile)
  assert.equal(result.engine, 'text-first-complete-link-v1')
  assert.ok(result.autoMerge.some((pair) => new Set([pair.leftCatalogItemId, pair.rightCatalogItemId]).has(items[0].catalogItemId) && new Set([pair.leftCatalogItemId, pair.rightCatalogItemId]).has(items[1].catalogItemId)))
  assert.ok(result.keepSeparate.some((pair) => new Set([pair.leftCatalogItemId, pair.rightCatalogItemId]).has(items[2].catalogItemId) && new Set([pair.leftCatalogItemId, pair.rightCatalogItemId]).has(items[3].catalogItemId)))
  assert.ok(result.review.length >= 1)
  assert.equal(result.pairDecisions.length, result.autoMerge.length + result.review.length + result.keepSeparate.length)
  assert.ok(result.pairDecisions.every((pair) => pair.pairId && pair.items.length === 2 && pair.items.every((entry) => entry.id)))
  const template = buildReviewTemplate(result, items)
  assert.equal(template.reviewPairs.length, result.review.length)
  assert.ok(template.reviewPairs.every((decision) => decision.pairId && decision.items.every((entry) => entry.id) && decision.imageDecision === null))
})

test('complete-link safety refuses a transitive scale conflict', () => {
  const profile = resolveProfile('cheshire')
  const items = [
    item('a', 'Cheshire Crystal Dress', { scale: '1/7' }),
    item('b', 'Cheshire Crystal Dress Renewal', { scale: null }),
    item('c', 'Cheshire Crystal Dress Special Color', { scale: '1/6' }),
  ]
  const result = produceGrouping(items, profile)
  assert.equal(result.keepSeparate.length, 1)
  assert.equal(result.autoMerge.length, 1)
  assert.ok(result.review.some((pair) => pair.reason === 'COMPLETE_LINK_CONFLICT'))
})

test('projection input is figures-like and independent from collector internals', () => {
  const profile = resolveProfile('cheshire')
  const value = buildProjectionInput(profile, [item('projection', 'Cheshire Projection Figure')])
  assert.equal(value.character, '柴郡')
  assert.equal(value.characterSlug, 'cheshire')
  assert.equal(value.items.length, 1)
  assert.equal(value.count, 1)
  assert.equal(value.items[0].id.startsWith('catalog-'), true)
  assert.equal(value.items[0].image_urls.length, 1)
  assert.equal(value.items[0].source_urls.length, 1)
  assert.deepEqual(value.items[0].sources, ['solaris'])
})
