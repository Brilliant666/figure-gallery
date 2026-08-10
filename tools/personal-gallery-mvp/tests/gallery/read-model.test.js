import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  canonicalizePrototypePreferences,
  loadGalleryByQuery,
  loadPrototypeGallery,
  loadRunGallery,
  listRecentRuns,
  normalizePreferences,
  normalizePrototypeAliases,
  normalizeQuery,
  resolveMediaObject,
  savePreferences,
  selectCoverImage,
} from '../../src/gallery/read-model.js'
import { HPOI_FROZEN_STATUS } from '../../src/storage/source-status.js'

const SHA = 'a'.repeat(64)

test('normalizes local gallery manifests and preserves exclusions', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-read-model-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runId = '20260716T010203Z-柴郡'
  const runDirectory = path.join(root, 'runs', runId)
  const objectDirectory = path.join(root, 'objects', 'sha256', 'aa')
  await mkdir(runDirectory, { recursive: true })
  await mkdir(objectDirectory, { recursive: true })
  await writeFile(
    path.join(runDirectory, 'run.json'),
    JSON.stringify({ query: '柴郡', status: 'completed', startedAt: '2026-07-16T01:02:03Z' }),
  )
  await writeFile(
    path.join(runDirectory, 'products.json'),
    JSON.stringify([
      {
        id: 'synthetic-990001',
        title: 'Synthetic Cheshire Figure',
        manufacturer: 'Synthetic Maker',
        classification: 'likely_scale',
        scale: '1/7',
        sourceUrl: 'https://www.hpoi.net/hobby/990001',
        images: [{ sha256: SHA, width: 2, height: 3, mime: 'image/png' }],
      },
    ]),
  )
  await writeFile(path.join(runDirectory, 'failures.json'), JSON.stringify([{ reason: 'synthetic failure' }]))
  await writeFile(path.join(objectDirectory, `${SHA}.png`), Buffer.from('synthetic'))
  await savePreferences(root, 'cheshire', {
    excludedProductIds: ['synthetic-990001'],
    excludedImageSha256: [SHA],
    preferredCoverImage: { 'synthetic-990001': SHA },
    manualNote: { 'synthetic-990001': 'keep for comparison' },
  })

  const gallery = await loadRunGallery(root, runId)
  assert.equal(gallery.query, '柴郡')
  assert.equal(gallery.summary.products, 1)
  assert.equal(gallery.summary.images, 1)
  assert.equal(gallery.products[0].excluded, true)
  assert.equal(gallery.products[0].images[0].excluded, true)
  assert.equal((await loadGalleryByQuery(root, '柴郡')).runId, runId)
  assert.equal(await resolveMediaObject(root, SHA), path.join(objectDirectory, `${SHA}.png`))
})

test('query and preference normalization reject unsafe values', () => {
  assert.equal(normalizeQuery(' 柴 郡 / Azur '), '柴-郡-azur')
  assert.deepEqual(normalizePreferences({ excludedProductIds: ['one', 'one', 2] }).excludedProductIds, ['one'])
  assert.deepEqual(normalizePreferences({ excludedImageSha256: ['bad'] }).excludedImageSha256, [])
})

test('normalizes legacy cover preferences into one preferredCoverImageId per product', () => {
  const normalized = normalizePreferences({
    preferredCoverImage: { productA: SHA },
    manualNote: { productA: 'keep this pose' },
  })
  assert.equal(normalized.schemaVersion, 2)
  assert.deepEqual(normalized.products.productA, {
    preferredCoverImageId: SHA,
    manualNote: 'keep this pose',
  })
  assert.equal(normalized.preferredCoverImage.productA, SHA)
})

test('cover selection keeps manual priority and falls back when that image is excluded', () => {
  const manual = { sha256: 'a'.repeat(64), width: 600, height: 900, order: 2, excluded: false }
  const primary = {
    sha256: 'b'.repeat(64),
    width: 800,
    height: 1000,
    order: 0,
    excluded: false,
    isOfficialPrimary: true,
  }
  const large = { sha256: 'c'.repeat(64), width: 1200, height: 1600, order: 1, excluded: false }
  assert.deepEqual(selectCoverImage([primary, large, manual], manual.sha256), {
    image: manual,
    source: 'manual_override',
    preferredCoverUnavailable: false,
  })
  manual.excluded = true
  const fallback = selectCoverImage([primary, large, manual], manual.sha256)
  assert.equal(fallback.image.sha256, primary.sha256)
  assert.equal(fallback.source, 'official_primary')
  assert.equal(fallback.preferredCoverUnavailable, true)
  manual.excluded = false
  assert.equal(selectCoverImage([large, manual], '').image.sha256, large.sha256)
})

test('seven-product fixture keeps 56 detail images but exposes only six index covers', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-reference-model-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runId = 'synthetic-reference-index-run'
  const runDirectory = path.join(root, 'runs', runId)
  await mkdir(runDirectory, { recursive: true })
  await writeFile(path.join(runDirectory, 'run.json'), JSON.stringify({
    runId,
    query: '柴郡',
    characterSlug: 'cheshire',
    sourceMode: 'official_sources',
    status: 'completed',
  }))
  let sequence = 1
  const imageCounts = [8, 10, 9, 10, 9, 10, 0]
  const products = imageCounts.map((count, productIndex) => {
    const images = Array.from({ length: count }, (_, imageIndex) => ({
      sha256: (sequence++).toString(16).padStart(64, '0'),
      width: 600 + imageIndex,
      height: 900 + imageIndex,
      mime: 'image/png',
      sourceUrl: `https://images.synthetic.invalid/${productIndex}/${imageIndex}.png`,
      isOfficialPrimary: imageIndex === 0,
    }))
    return {
      id: `synthetic-product-${productIndex + 1}`,
      title: `Synthetic product ${productIndex + 1}`,
      manufacturer: productIndex === 6 ? 'APEX' : 'Synthetic Maker',
      classification: 'likely_scale',
      homepageImage: images[0]?.sourceUrl || null,
      imageUrls: productIndex === 6
        ? [1, 2, 3].map((value) => `https://images.synthetic.invalid/apex-${value}.png`)
        : images.map((image) => image.sourceUrl),
      images,
    }
  })
  await writeFile(path.join(runDirectory, 'products.json'), JSON.stringify(products))
  await writeFile(path.join(runDirectory, 'failures.json'), JSON.stringify(
    products[6].imageUrls.map((url) => ({ kind: 'image', code: 'http_404', status: 404, url })),
  ))
  await savePreferences(root, 'cheshire', {
    products: { 'synthetic-product-1': { preferredCoverImageId: products[0].images[1].sha256 } },
  })

  const gallery = await loadRunGallery(root, runId)
  assert.equal(gallery.products.length, 7)
  assert.equal(gallery.summary.images, 56)
  assert.equal(gallery.summary.indexCovers, 6)
  assert.equal(gallery.summary.productsWithoutImages, 1)
  assert.equal(gallery.products.filter((product) => product.coverImage).length, 6)
  assert.equal(gallery.products[0].coverSelectionSource, 'manual_override')
  assert.equal(gallery.products[0].images.length, 8)
  assert.equal(gallery.products[6].coverImage, null)
  assert.equal(gallery.products[6].failureCount, 3)
  assert.deepEqual(gallery.products[6].imageFailures.map((failure) => failure.status), [404, 404, 404])
})

test('resolves GalleryStore product summaries, product fields, and image index objects', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-store-shape-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runId = '2026-07-16T02-00-00Z-synthetic'
  const runDirectory = path.join(root, 'runs', runId)
  await mkdir(runDirectory, { recursive: true })
  await mkdir(path.join(root, 'products'), { recursive: true })
  await writeFile(path.join(runDirectory, 'run.json'), JSON.stringify({ query: '柴郡', status: 'completed' }))
  await writeFile(
    path.join(runDirectory, 'products.json'),
    JSON.stringify([{ productKey: 'hpoi-id-synthetic-990002', state: 'new' }]),
  )
  await writeFile(path.join(runDirectory, 'failures.json'), '[]')
  await writeFile(
    path.join(root, 'products', 'hpoi-id-synthetic-990002.json'),
    JSON.stringify({
      productKey: 'hpoi-id-synthetic-990002',
      fields: {
        title: 'Synthetic stored product',
        manufacturer: 'Synthetic Maker',
        classification: 'likely_prize',
        rawCategory: 'prize',
        rawScale: 'non-scale',
        sourceUrl: 'https://www.hpoi.net/hobby/990002',
      },
      imageSha256: [SHA],
    }),
  )
  await writeFile(
    path.join(root, 'image-index.json'),
    JSON.stringify({
      objects: {
        [SHA]: { sha256: SHA, extension: 'png', mime: 'image/png', width: 240, height: 360 },
      },
    }),
  )

  const gallery = await loadRunGallery(root, runId)
  assert.equal(gallery.products.length, 1)
  assert.match(gallery.products[0].id, /^azur-lane_cheshire_hpoi-url-/u)
  assert.equal(gallery.products[0].title, 'Synthetic stored product')
  assert.equal(gallery.products[0].classification, 'likely_prize')
  assert.equal(gallery.products[0].images[0].sha256, SHA)
})

test('prefers immutable per-run product snapshots so historical galleries do not drift', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-run-snapshot-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runId = 'synthetic-historical-run'
  const productKey = 'hpoi-id-synthetic-990003'
  const runDirectory = path.join(root, 'runs', runId)
  await mkdir(runDirectory, { recursive: true })
  await mkdir(path.join(root, 'products'), { recursive: true })
  await writeFile(path.join(runDirectory, 'run.json'), JSON.stringify({ query: '柴郡', status: 'completed' }))
  await writeFile(path.join(runDirectory, 'failures.json'), '[]')
  await writeFile(
    path.join(runDirectory, 'products.json'),
    JSON.stringify([
      {
        productKey,
        state: 'new',
        fields: {
          title: 'Historical synthetic title',
          manufacturer: 'Historical synthetic maker',
          classification: 'unknown',
        },
        imageSha256: [SHA],
      },
    ]),
  )
  await writeFile(
    path.join(root, 'products', `${productKey}.json`),
    JSON.stringify({
      productKey,
      fields: {
        title: 'Later changed synthetic title',
        manufacturer: 'Later synthetic maker',
        classification: 'likely_scale',
      },
      imageSha256: [],
    }),
  )
  await writeFile(
    path.join(root, 'image-index.json'),
    JSON.stringify({ objects: { [SHA]: { sha256: SHA, mime: 'image/png', width: 1, height: 1 } } }),
  )

  const gallery = await loadRunGallery(root, runId)
  assert.equal(gallery.products[0].title, 'Historical synthetic title')
  assert.equal(gallery.products[0].classification, 'unknown')
  assert.equal(gallery.products[0].images[0].sha256, SHA)
})

test('projects official-source fields and resolves the stable Cheshire gallery to the latest usable run', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-official-read-model-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const successfulRunId = '20260718T010000Z-official-cheshire'
  const failedRunId = '20260718T020000Z-official-cheshire-failed'
  const successfulDirectory = path.join(root, 'runs', successfulRunId)
  const failedDirectory = path.join(root, 'runs', failedRunId)
  await mkdir(successfulDirectory, { recursive: true })
  await mkdir(failedDirectory, { recursive: true })
  await writeFile(
    path.join(successfulDirectory, 'run.json'),
    JSON.stringify({
      runId: successfulRunId,
      query: '柴郡',
      characterSlug: 'cheshire',
      sourceMode: 'official_sources',
      status: 'completed',
      startedAt: '2026-07-18T01:00:00Z',
      completedAt: '2026-07-18T01:00:10Z',
      sourceStatus: {
        hpoi: {
          hpoiLiveStatus: 'blocked_by_source',
          stopReason: 'captcha',
          retryAllowed: false,
          blockedAt: '2026-07-17T18:12:58Z',
          consecutiveBlockedRuns: 3,
        },
      },
    }),
  )
  await writeFile(
    path.join(successfulDirectory, 'products.json'),
    JSON.stringify([
      {
        productKey: 'official-goodsmile-com-id-cheshire-001',
        fieldDigest: 'b'.repeat(64),
        lastSeenAt: '2026-07-18T01:00:08Z',
        fields: {
          sourceKind: 'official_manufacturer',
          sourceDomain: 'www.goodsmile.com',
          discoveryQuery: '"Azur Lane" Cheshire figure',
          discoveryMethod: 'firecrawl_search',
          officialProductId: 'cheshire-001',
          title: 'Cheshire: Summery Date!',
          character: 'Cheshire',
          series: 'Azur Lane',
          manufacturer: 'Good Smile Arts Shanghai',
          distributor: 'Good Smile Company',
          classification: 'likely_scale',
          category: 'scale figure',
          scale: '1/7',
          height: '260 mm',
          releaseDate: '2026-08',
          price: '¥24,800',
          sculptor: 'Synthetic Sculptor',
          paintwork: 'Synthetic Paintwork',
          description: 'Synthetic official-style fixture content.',
          sourceUrl: 'https://www.goodsmile.com/en/product/cheshire-001',
          parserVersion: 'official-product-v1',
        },
        imageSha256: [SHA],
      },
    ]),
  )
  await writeFile(path.join(successfulDirectory, 'failures.json'), '[]')
  await writeFile(
    path.join(failedDirectory, 'run.json'),
    JSON.stringify({
      runId: failedRunId,
      query: '柴郡',
      characterSlug: 'cheshire',
      sourceMode: 'official_sources',
      status: 'failed',
      stopReason: 'synthetic failure',
    }),
  )
  await writeFile(path.join(failedDirectory, 'products.json'), '[]')
  await writeFile(path.join(failedDirectory, 'failures.json'), JSON.stringify([{ reason: 'synthetic failure' }]))
  await writeFile(
    path.join(root, 'image-index.json'),
    JSON.stringify({ objects: { [SHA]: { sha256: SHA, mime: 'image/png', width: 240, height: 360 } } }),
  )

  const gallery = await loadGalleryByQuery(root, 'cheshire')
  assert.equal(gallery.runId, successfulRunId)
  assert.equal(gallery.characterSlug, 'cheshire')
  assert.equal(gallery.sourceMode, 'official_sources')
  assert.deepEqual(gallery.sourceStatus.hpoi, HPOI_FROZEN_STATUS)
  assert.equal(gallery.summary.officialProducts, 1)
  assert.equal(gallery.summary.officialImages, 1)
  assert.equal(gallery.products[0].sourceKind, 'official_manufacturer')
  assert.equal(gallery.products[0].sourceDomain, 'www.goodsmile.com')
  assert.equal(gallery.products[0].discoveryMethod, 'firecrawl_search')
  assert.equal(gallery.products[0].officialProductId, 'cheshire-001')
  assert.equal(gallery.products[0].series, 'Azur Lane')
  assert.equal(gallery.products[0].releaseDate, '2026-08')
  assert.equal(gallery.products[0].fieldDigest, 'b'.repeat(64))
  assert.equal(gallery.products[0].lastSeenAt, '2026-07-18T01:00:08Z')

  const recent = await listRecentRuns(root, 2)
  assert.equal(recent[0].characterSlug, 'cheshire')
  assert.equal(recent[0].sourceMode, 'official_sources')
})

test('canonicalizes retired prototype preference keys without hiding a mixed-state survivor', () => {
  const survivor = 'rem-proto-survivor'
  const retiredA = 'rem-proto-retired-a'
  const retiredB = 'rem-proto-retired-b'
  const aliases = normalizePrototypeAliases({
    [retiredA]: survivor,
    [retiredB]: survivor,
  }, [survivor])
  const normalized = canonicalizePrototypePreferences({
    excludedProductIds: [retiredA],
    excludedImageSha256: [SHA],
    products: {
      [retiredA]: { preferredCoverImageUrl: 'https://images.goodsmile.info/rem-retired.jpg' },
      [retiredB]: { manualNote: 'retired note' },
    },
  }, aliases)

  assert.deepEqual(normalized.excludedProductIds, [])
  assert.deepEqual(normalized.excludedImageSha256, [SHA])
  assert.deepEqual(normalized.products[survivor], {
    preferredCoverImageUrl: 'https://images.goodsmile.info/rem-retired.jpg',
    manualNote: 'retired note',
  })
  assert.equal(Object.hasOwn(normalized.products, retiredA), false)
  assert.equal(Object.hasOwn(normalized.products, retiredB), false)

  const allExcluded = canonicalizePrototypePreferences({
    excludedProductIds: [survivor, retiredA, retiredB],
  }, aliases)
  assert.deepEqual(allExcluded.excludedProductIds, [survivor])
  const currentUiExclusion = canonicalizePrototypePreferences({
    excludedProductIds: [survivor],
  }, aliases)
  assert.deepEqual(currentUiExclusion.excludedProductIds, [survivor])

  const survivorCoverWins = canonicalizePrototypePreferences({
    products: {
      [survivor]: { preferredCoverImageId: SHA },
      [retiredA]: { preferredCoverImageUrl: 'https://images.goodsmile.info/retired-cover.jpg' },
    },
  }, aliases)
  assert.deepEqual(survivorCoverWins.products[survivor], { preferredCoverImageId: SHA })

  const duplicateNotes = canonicalizePrototypePreferences({
    products: {
      [survivor]: { manualNote: 'same note' },
      [retiredA]: { manualNote: 'same note' },
      [retiredB]: { manualNote: 'same note' },
    },
  }, aliases)
  assert.equal(duplicateNotes.products[survivor].manualNote, 'same note')

  const distinctNotes = canonicalizePrototypePreferences({
    products: {
      [survivor]: { manualNote: 'survivor note' },
      [retiredA]: { manualNote: 'retired note' },
    },
  }, aliases)
  assert.equal(
    distinctNotes.products[survivor].manualNote,
    `[${retiredA}] retired note\n[${survivor}] survivor note`,
  )
})

test('loads a reversible prototype projection before the legacy Rem product run', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-projection-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const characterDirectory = path.join(root, 'characters', 'rem')
  await mkdir(characterDirectory, { recursive: true })
  const coverUrl = 'https://images.goodsmile.info/cgm/images/product/20200101/1.jpg'
  const alternateUrl = 'https://cdn.shopify.com/s/files/1/0318/2649/files/rem-2.jpg'
  await writeFile(path.join(characterDirectory, 'preferences.json'), JSON.stringify({
    schemaVersion: 2,
    excludedProductIds: [],
    excludedImageSha256: [],
    products: {
      'rem-proto-0123456789abcdef': { preferredCoverImageUrl: alternateUrl },
    },
    preferredCoverImage: { 'rem-proto-0123456789abcdef': alternateUrl },
    manualNote: {},
  }))
  await writeFile(path.join(characterDirectory, 'prototype-projection.json'), JSON.stringify({
    schemaVersion: 1,
    projectionVersion: 'rem-prototype-projection-v1',
    viewMode: 'prototype_projection',
    character: 'Rem',
    characterSlug: 'rem',
    prototypeAliases: {
      'rem-proto-retired0000001': 'rem-proto-0123456789abcdef',
    },
    sort: {
      mode: 'recommended_reference_completeness_v1',
      label: '推荐',
      signals: ['hasCover', 'imageBucket'],
    },
    summary: {
      catalogItemCount: 2,
      projectionEligibleCount: 2,
      prototypeCount: 1,
      singletonPrototypeCount: 0,
      multiItemPrototypeCount: 1,
      groupingConflictCount: 0,
      imageCount: 2,
      prototypeWithImageCount: 1,
      manufacturerCount: 1,
    },
    prototypes: [{
      prototypeId: 'rem-proto-0123456789abcdef',
      membershipFingerprint: 'f'.repeat(64),
      catalogItemIds: ['goodsmile:1', 'solaris:2'],
      title: 'Rem Yukata',
      manufacturer: 'KADOKAWA',
      manufacturers: ['KADOKAWA'],
      classification: 'likely_scale',
      category: 'General',
      cover: { id: 'image-ref-cover', url: coverUrl, catalogItemId: 'goodsmile:1', sourceFamily: 'goodsmile', isMain: true },
      images: [
        { id: 'image-ref-cover', url: coverUrl, catalogItemId: 'goodsmile:1', sourceFamily: 'goodsmile', isMain: true },
        { id: 'image-ref-alt', url: alternateUrl, catalogItemId: 'solaris:2', sourceFamily: 'solaris', isMain: true },
        { id: 'image-ref-unsafe', url: 'https://images.invalid/rem.jpg', catalogItemId: 'solaris:2', sourceFamily: 'solaris' },
      ],
      catalogItems: [
        {
          id: 'goodsmile:1', title: 'Rem Yukata Renewal', manufacturer: 'KADOKAWA', type: 'scale', scale: '1/7',
          release: '2025/06', source: 'Good Smile Company', sourceFamily: 'goodsmile',
          sourceUrls: ['https://www.goodsmile.com/en/product/1'],
        },
        {
          id: 'solaris:2', title: 'Rem Yukata Original', manufacturer: 'KADOKAWA', type: 'scale', scale: '1/7',
          source: 'Solaris Japan', sourceFamily: 'solaris',
          sourceUrls: ['https://solarisjapan.com/products/rem-yukata'],
        },
      ],
      sources: [
        { url: 'https://www.goodsmile.com/en/product/1', sourceFamily: 'goodsmile', label: 'Good Smile — official' },
        { url: 'https://solarisjapan.com/products/rem-yukata', sourceFamily: 'solaris', label: 'Solaris Japan — catalog/retailer source' },
      ],
    }],
  }))

  const direct = await loadPrototypeGallery(root, {
    characterId: 'rezero:rem', slug: 'rem', displayName: '蕾姆', aliases: ['蕾姆', 'Rem'], workNames: ['Re:ZERO'],
  })
  assert.equal(direct.viewMode, 'prototype_projection')
  assert.equal(direct.summary.catalogItemCount, 2)
  assert.equal(direct.summary.projectionEligibleCount, 2)
  assert.equal(direct.summary.prototypeCount, 1)
  assert.equal(direct.products.length, 1)
  assert.equal(direct.products[0].images.length, 2)
  assert.equal(direct.products[0].coverImage.url, alternateUrl)
  assert.equal(direct.products[0].coverSelectionSource, 'manual_override')
  assert.equal(direct.products[0].catalogItems.length, 2)
  assert.deepEqual(direct.products[0].images.map((image) => image.sourceFamily), ['goodsmile', 'solaris'])
  assert.equal(direct.products[0].sources[1].sourceFamily, 'solaris')
  assert.equal(direct.products[0].membershipFingerprint, 'f'.repeat(64))
  assert.deepEqual(direct.prototypeAliases, {
    'rem-proto-retired0000001': 'rem-proto-0123456789abcdef',
  })
  assert.deepEqual(direct.sort, {
    mode: 'recommended_reference_completeness_v1',
    label: '推荐',
    signals: ['hasCover', 'imageBucket'],
  })

  const byQuery = await loadGalleryByQuery(root, '蕾姆')
  assert.equal(byQuery.viewMode, 'prototype_projection')
  assert.equal(byQuery.products[0].id, 'rem-proto-0123456789abcdef')
})

test('savePreferences canonicalizes stale retired prototype keys from an old page', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-alias-preferences-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const characterDirectory = path.join(root, 'characters', 'rem')
  await mkdir(characterDirectory, { recursive: true })
  await writeFile(path.join(characterDirectory, 'prototype-projection.json'), JSON.stringify({
    schemaVersion: 2,
    projectionVersion: 'rem-prototype-projection-v2',
    viewMode: 'prototype_projection',
    characterSlug: 'rem',
    prototypeAliases: { 'rem-proto-retired': 'rem-proto-survivor' },
    prototypes: [{ prototypeId: 'rem-proto-survivor', images: [], catalogItems: [] }],
  }))

  const saved = await savePreferences(root, 'rem', {
    products: {
      'rem-proto-survivor': { manualNote: 'survivor note' },
      'rem-proto-retired': { manualNote: 'retired note' },
    },
    preferredCoverImage: {
      'rem-proto-retired': 'https://images.goodsmile.info/rem-cover.jpg',
    },
  })
  assert.deepEqual(saved.products['rem-proto-survivor'], {
    preferredCoverImageUrl: 'https://images.goodsmile.info/rem-cover.jpg',
    manualNote: '[rem-proto-retired] retired note\n[rem-proto-survivor] survivor note',
  })
  assert.equal(Object.hasOwn(saved.products, 'rem-proto-retired'), false)
  assert.deepEqual(saved.preferredCoverImage, {
    'rem-proto-survivor': 'https://images.goodsmile.info/rem-cover.jpg',
  })
})
