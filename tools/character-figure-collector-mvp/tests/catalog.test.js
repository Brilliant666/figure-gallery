import test from 'node:test'
import assert from 'node:assert/strict'
import { BUSINESS_DIGEST_VERSION, businessDigest, mergeCatalog, groupingInputItem } from '../src/catalog.js'
import { record } from '../src/records.js'
import { resolveProfile } from '../src/profiles.js'

function sourceRecord({
  family = 'solaris',
  id = '1',
  title = 'Azur Lane Cheshire Summer Pose Figure',
  manufacturer = 'Taito',
  scale = null,
  images = ['https://img.example/a.jpg'],
} = {}) {
  return record({
    sourceFamily: family,
    sourceId: id,
    sourceUrl: `https://${family === 'solaris' ? 'solarisjapan.com' : 'japan-figure.com'}/products/${id}`,
    character: resolveProfile('cheshire'),
    title,
    series: 'Azur Lane',
    manufacturer,
    category: 'Prize',
    scale,
    imageUrls: images,
  })
}

function semanticRecord({ family, id, title, manufacturer = 'Good Smile Arts Shanghai', scale = '1/7' }) {
  return record({
    sourceFamily: family,
    sourceId: id,
    sourceUrl: `https://${family === 'solaris' ? 'solarisjapan.com' : 'www.goodsmile.com'}/products/${id}`,
    character: resolveProfile('cheshire'),
    title,
    series: 'Azur Lane',
    manufacturer,
    category: 'Scale Figure',
    scale,
  })
}

test('source identity, exact cross-source merge, and refresh are idempotent', () => {
  const first = mergeCatalog([], [sourceRecord()], '2026-08-10T00:00:00.000Z')
  assert.equal(first.items.length, 1)
  assert.equal(first.changes.new, 1)
  const second = mergeCatalog(first.items, [sourceRecord()], '2026-08-10T00:10:00.000Z')
  assert.equal(second.items.length, 1)
  assert.equal(second.items[0].catalogItemId, first.items[0].catalogItemId)
  assert.equal(second.changes.unchanged, 1)
  const crossSource = mergeCatalog(second.items, [sourceRecord({ family: 'japan-figure', id: 'JF-1' })], '2026-08-10T00:20:00.000Z')
  assert.equal(crossSource.items.length, 1)
  assert.equal(crossSource.items[0].sourceRefs.length, 2)
  assert.equal(crossSource.items[0].catalogItemId, first.items[0].catalogItemId)
  const grouping = groupingInputItem(crossSource.items[0])
  assert.match(grouping.comparisonKey, /^azurlanecheshiresummerposefigure\|taito$/u)
  assert.equal(grouping.sourceIdentities.length, 2)
  const reorderedCollections = {
    ...crossSource.items[0],
    tags: [...crossSource.items[0].tags].reverse(),
    images: [...crossSource.items[0].images].reverse(),
    sourceRefs: [...crossSource.items[0].sourceRefs].reverse(),
  }
  assert.equal(businessDigest(reorderedCollections), crossSource.items[0].businessDigest)
})

test('field changes are reported without creating another item', () => {
  const first = mergeCatalog([], [sourceRecord()], '2026-08-10T00:00:00.000Z')
  const changed = sourceRecord({ images: ['https://img.example/b.jpg'] })
  const second = mergeCatalog(first.items, [changed], '2026-08-10T00:10:00.000Z')
  assert.equal(second.items.length, 1)
  assert.equal(second.changes.changed, 1)
})

test('volatile source observation timestamps do not create false catalog changes', () => {
  const initial = sourceRecord()
  Object.assign(initial, {
    sourceUpdatedAt: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
    fetchedAt: '2026-08-10T00:00:01.000Z',
    lastFetchedAt: '2026-08-10T00:00:02.000Z',
    requestTimestamp: '2026-08-10T00:00:03.000Z',
    crawlTimestamp: '2026-08-10T00:00:04.000Z',
    httpResponseTiming: 123,
    runtimePath: 'runtime/first',
    generatedAt: '2026-08-10T00:00:05.000Z',
  })
  const first = mergeCatalog([], [initial], '2026-08-10T00:00:00.000Z')
  const refreshed = sourceRecord()
  Object.assign(refreshed, {
    sourceUpdatedAt: '2026-08-10T00:10:00.000Z',
    updated_at: '2026-08-10T00:10:00.000Z',
    fetchedAt: '2026-08-10T00:10:01.000Z',
    lastFetchedAt: '2026-08-10T00:10:02.000Z',
    requestTimestamp: '2026-08-10T00:10:03.000Z',
    crawlTimestamp: '2026-08-10T00:10:04.000Z',
    httpResponseTiming: 456,
    runtimePath: 'runtime/second',
    generatedAt: '2026-08-10T00:10:05.000Z',
  })
  const second = mergeCatalog(first.items, [refreshed], '2026-08-10T00:10:00.000Z')
  assert.equal(second.changes.unchanged, 1)
  assert.equal(second.changes.changed, 0)
  assert.equal(second.items[0].sourceUpdatedAt, refreshed.sourceUpdatedAt)
  assert.equal(second.items[0].businessDigest, first.items[0].businessDigest)
})

test('image response ordering does not create a false catalog change', () => {
  const first = mergeCatalog([], [sourceRecord({ images: [
    'https://img.example/a.jpg',
    'https://img.example/b.jpg',
    'https://img.example/c.jpg',
  ] })], '2026-08-10T00:00:00.000Z')
  const second = mergeCatalog(first.items, [sourceRecord({ images: [
    'https://img.example/c.jpg',
    'https://img.example/a.jpg',
    'https://img.example/b.jpg',
  ] })], '2026-08-10T00:10:00.000Z')
  assert.equal(second.changes.changed, 0)
  assert.equal(second.changes.unchanged, 1)
  assert.equal(second.items[0].businessDigest, first.items[0].businessDigest)
})

test('title, manufacturer, scale, and image-set changes remain real business changes', () => {
  const first = mergeCatalog([], [sourceRecord()], '2026-08-10T00:00:00.000Z')
  const changes = [
    sourceRecord({ title: 'Azur Lane Cheshire Winter Pose Figure' }),
    sourceRecord({ manufacturer: 'APEX' }),
    sourceRecord({ scale: '1/7' }),
    sourceRecord({ images: ['https://img.example/a.jpg', 'https://img.example/b.jpg'] }),
  ]
  for (const incoming of changes) {
    const refreshed = mergeCatalog(first.items, [incoming], '2026-08-10T00:10:00.000Z')
    assert.equal(refreshed.changes.changed, 1)
    assert.equal(refreshed.changes.unchanged, 0)
  }
})

test('legacy digest baselines upgrade silently and remain idempotent', () => {
  const first = mergeCatalog([], [sourceRecord({ images: [
    'https://img.example/a.jpg',
    'https://img.example/b.jpg',
  ] })], '2026-08-10T00:00:00.000Z')
  const legacy = {
    ...first.items[0],
    images: [...first.items[0].images].reverse(),
    sourceUpdatedAt: '2026-08-10T00:01:00.000Z',
    digest: 'legacy-v1-digest',
  }
  delete legacy.businessDigest
  delete legacy.businessDigestVersion

  const migrated = mergeCatalog([legacy], [sourceRecord({ images: [
    'https://img.example/b.jpg',
    'https://img.example/a.jpg',
  ] })], '2026-08-10T00:10:00.000Z')
  assert.equal(migrated.changes.changed, 0)
  assert.equal(migrated.changes.unchanged, 1)
  assert.equal(migrated.items[0].businessDigestVersion, BUSINESS_DIGEST_VERSION)
  assert.equal(migrated.items[0].businessDigest, businessDigest(migrated.items[0]))
  assert.equal(migrated.items[0].digest, migrated.items[0].businessDigest)

  const repeated = mergeCatalog(migrated.items, [sourceRecord({ images: [
    'https://img.example/a.jpg',
    'https://img.example/b.jpg',
  ] })], '2026-08-10T00:20:00.000Z')
  assert.equal(repeated.changes.changed, 0)
  assert.equal(repeated.changes.unchanged, 1)
  assert.equal(repeated.items[0].businessDigest, migrated.items[0].businessDigest)
})

test('profile semantic core merges the three reviewed GSC/Solaris products', () => {
  const pairs = [
    ['Summery Date', 'Cheshire Summery Date 1/7 Scale Figure', 'Azur Lane - Cheshire - Summery Date Ver. - 1/7 Complete Figure [Good Smile Arts Shanghai]'],
    ['Cait Sith Crooner', 'Cheshire Cait Sith Crooner 1/7 Scale Figure', 'Azur Lane Cheshire Cait Sith Crooner Ver. Complete Figure (Good Smile Arts Shanghai)'],
    ['Cat Magic Hat', 'Cheshire The Cat in the Magic Hat 1/7 Scale Figure', 'Azur Lane - Cheshire - The Cat in the Magic Hat - 1/7 Complete Figure - Good Smile Arts Shanghai'],
  ]
  for (const [label, goodSmileTitle, solarisTitle] of pairs) {
    const merged = mergeCatalog([], [
      semanticRecord({ family: 'goodsmile', id: `${label}-g`, title: goodSmileTitle }),
      semanticRecord({ family: 'solaris', id: `${label}-s`, title: solarisTitle, manufacturer: 'Good Smile Arts Shanghai, Good Smile Company' }),
    ])
    assert.equal(merged.items.length, 1, label)
    assert.equal(merged.items[0].sourceRefs.length, 2, label)
  }
})

test('real Solaris combined Good Smile vendor spelling maps to the reviewed maker family', () => {
  const merged = mergeCatalog([], [
    semanticRecord({ family: 'goodsmile', id: 'vendor-g', title: 'Cheshire Summery Date 1/7 Scale Figure' }),
    semanticRecord({ family: 'solaris', id: 'vendor-s', title: 'Azur Lane Cheshire Summery Date Ver. 1/7 Complete Figure', manufacturer: 'Good Smile Arts Shanghai as ManufacturerGood Smile Company' }),
  ])
  assert.equal(merged.items.length, 1)
})

test('scale and manufacturer protect a different AniGame Cat Magic sculpt', () => {
  const merged = mergeCatalog([], [
    semanticRecord({ family: 'goodsmile', id: 'magic-g', title: 'Cheshire The Cat in the Magic Hat 1/7 Scale Figure' }),
    semanticRecord({ family: 'solaris', id: 'magic-a', title: 'Azur Lane Cheshire The Cat in Magic 1/6 Scale Figure', manufacturer: 'AniGame', scale: '1/6' }),
  ])
  assert.equal(merged.items.length, 2)
})

test('source spelling and token-order differences merge reviewed duplicate listings', () => {
  const cases = [
    [
      semanticRecord({ family: 'japan-figure', id: 'lime-jf', title: 'Apex Azure Lane Cheshire Date Summer Figure 1/8 Scale PVC ABS', manufacturer: 'APEX', scale: '1/8' }),
      semanticRecord({ family: 'solaris', id: 'lime-sol', title: 'Azur Lane - Cheshire - Manjuu - Limepie - 1/8 - Summery Date! Ver. (Apex Innovation)', manufacturer: 'Apex Innovation', scale: '1/8' }),
    ],
    [
      semanticRecord({ family: 'japan-figure', id: 'shake-jf', title: 'Apex HappyShake Azure Lane Chesher Figure - PVC ABS Metal Collectible', manufacturer: 'APEX', scale: null }),
      semanticRecord({ family: 'solaris', id: 'shake-sol', title: 'Azur Lane - Cheshire - Happy Shake (Apex Innovation)', manufacturer: 'Apex Innovation', scale: null }),
    ],
    [
      semanticRecord({ family: 'japan-figure', id: 'set-jf', title: 'Hanabee Azur Lane Prepainted Summer Swimsuit Figure Trio', manufacturer: 'Hanabee', scale: null }),
      semanticRecord({ family: 'solaris', id: 'set-sol', title: 'Azur Lane - Summer Swimsuit - Set (Hanabee)', manufacturer: 'Hanabee', scale: null }),
    ],
  ]
  for (const records of cases) assert.equal(mergeCatalog([], records).items.length, 1)
})
