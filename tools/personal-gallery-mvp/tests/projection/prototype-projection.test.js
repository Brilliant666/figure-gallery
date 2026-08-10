import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ART_SCALE_FILTER_LEAK_ID,
  buildCharacterProjectionFromFiles,
  buildCharacterPrototypeProjection,
  buildProjectionFromCollector,
  buildPrototypeProjection,
  buildPrototypeProjectionState,
  classifyCatalogItem,
  legacyMembershipPrototypeId,
  normalizeCharacterCatalog,
  sourceFamilyForUrl,
} from '../../src/projection/prototype-projection.js'

function item(id, overrides = {}) {
  return {
    id,
    character: 'Rem',
    title: `Synthetic ${id}`,
    manufacturer: 'Synthetic Maker',
    category: 'Synthetic Category',
    image_url: null,
    image_urls: [],
    source: 'Synthetic Source',
    source_urls: [],
    ...overrides,
  }
}

function evidenceEdge(pairId, decision, left, right) {
  return { pairId, imageDecision: decision, items: [{ id: left }, { id: right }] }
}

function syntheticInputs({ conflict = false } = {}) {
  const items = [
    item('item-a', {
      image_url: 'https://www.goodsmile.com/example/main.jpg',
      image_urls: ['https://www.goodsmile.com/example/main.jpg'],
      source_urls: ['https://www.goodsmile.com/example/product'],
    }),
    item('item-b', {
      image_url: 'https://cdn.shopify.com/s/files/1/0318/2649/products/solar.jpg',
      image_urls: ['https://cdn.shopify.com/s/files/1/0318/2649/products/solar.jpg'],
      source_urls: ['https://solarisjapan.com/products/synthetic'],
    }),
    item('item-c'),
    item('item-d'),
    item('item-e'),
    item('item-f'),
    item(ART_SCALE_FILTER_LEAK_ID, { title: 'Synthetic ArtScale bust leak' }),
  ]
  return {
    figures: { count: items.length, character: 'Rem', items },
    groupingResults: {
      pairDecisions: [{ decision: 'AUTO_MERGE', items: ['item-a', 'item-b'] }],
      autoMergeGroups: 1,
      autoMergeItems: 2,
    },
    imageEvidence: {
      reviewPairs: [
        evidenceEdge('review-01', 'IMAGE_SUPPORTS_SAME', 'item-b', 'item-c'),
        evidenceEdge('review-02', 'IMAGE_SUPPORTS_DIFFERENT', 'item-c', 'item-d'),
        evidenceEdge('review-03', 'IMAGE_INCONCLUSIVE', 'item-e', 'item-f'),
        ...(conflict ? [evidenceEdge('review-04', 'IMAGE_SUPPORTS_SAME', 'item-a', 'item-d')] : []),
      ],
    },
  }
}

test('source family uses the image host and Shopify store path without guessing', () => {
  assert.equal(sourceFamilyForUrl('https://images.goodsmile.info/cgm/images/product/x.jpg'), 'goodsmile')
  assert.equal(
    sourceFamilyForUrl('https://cdn.shopify.com/s/files/1/0318/2649/products/x.jpg'),
    'solaris',
  )
  assert.equal(
    sourceFamilyForUrl('https://cdn.shopify.com/s/files/1/0568/2298/8958/products/x.jpg'),
    'japan-figure',
  )
  assert.equal(sourceFamilyForUrl('https://cdn.shopify.com/s/files/1/9999/1/products/x.jpg'), 'unknown')
  assert.equal(sourceFamilyForUrl('not a URL'), 'unknown')
})

test('catalog classification preserves the frozen useful static categories', () => {
  assert.equal(classifyCatalogItem({ category: 'Prize' }), 'likely_prize')
  assert.equal(classifyCatalogItem({ category: 'General', scale: '1/7' }), 'likely_scale')
  assert.equal(classifyCatalogItem({ category: '1/8th Scale' }), 'likely_scale')
  assert.equal(classifyCatalogItem({ category: 'Non-Scale Figure' }), 'likely_static')
  assert.equal(classifyCatalogItem({ category: 'POP UP PARADE' }), 'likely_static')
  assert.equal(classifyCatalogItem({ category: '' }), 'unknown')
})

test('legacy bootstrap IDs are deterministic and independent of input item order', () => {
  assert.equal(
    legacyMembershipPrototypeId(['item-b', 'item-a']),
    legacyMembershipPrototypeId(['item-a', 'item-b']),
  )
  assert.match(legacyMembershipPrototypeId(['item-a']), /^rem-proto-[a-f0-9]{16}$/u)
  assert.throws(() => legacyMembershipPrototypeId(['item-a', 'item-a']), /unique Catalog Item IDs/u)
})

test('projection excludes the known bust leak and applies AUTO plus frozen SAME edges', () => {
  const inputs = syntheticInputs()
  const first = buildPrototypeProjection({ ...inputs, generatedAt: '2026-08-10T00:00:00.000Z' })
  const second = buildPrototypeProjection({ ...inputs, generatedAt: '2026-08-11T00:00:00.000Z' })

  assert.equal(first.sourceCatalogItemCount, 7)
  assert.equal(first.projectionEligibleItemCount, 6)
  assert.equal(first.prototypeCount, 4)
  assert.equal(first.singletonPrototypeCount, 3)
  assert.equal(first.multiItemPrototypeCount, 1)
  assert.equal(first.largestPrototypeGroupSize, 3)
  assert.equal(first.catalogItemsCollapsed, 2)
  assert.equal(first.groupingConflictCount, 0)
  assert.deepEqual(first.excludedCatalogItems, [{
    catalogItemId: ART_SCALE_FILTER_LEAK_ID,
    title: 'Synthetic ArtScale bust leak',
    projectionExcluded: true,
    reason: 'confirmed bust/filter leak',
  }])
  assert.deepEqual(
    first.prototypes.map((prototype) => prototype.prototypeId),
    second.prototypes.map((prototype) => prototype.prototypeId),
  )

  const merged = first.prototypes.find((prototype) => prototype.catalogItemIds.includes('item-a'))
  assert.deepEqual(merged.catalogItemIds, ['item-a', 'item-b', 'item-c'])
  assert.equal(merged.cover.catalogItemId, 'item-a')
  assert.equal(merged.cover.sourceFamily, 'goodsmile')
  assert.equal(merged.images.length, 2)
  assert.deepEqual(merged.catalogItems[0].sources, [{
    url: 'https://www.goodsmile.com/example/product',
    sourceFamily: 'goodsmile',
    label: 'Good Smile',
    role: 'official',
  }])
  assert.equal(first.prototypes.some((prototype) => (
    prototype.catalogItemIds.includes('item-e') && prototype.catalogItemIds.includes('item-f')
  )), false)
})

test('a SAME edge that would swallow DIFFERENT is rejected conservatively', () => {
  const projection = buildPrototypeProjection({
    ...syntheticInputs({ conflict: true }),
    generatedAt: '2026-08-10T00:00:00.000Z',
  })
  assert.equal(projection.groupingConflictCount, 1)
  assert.deepEqual(projection.grouping.rejectedEdges, [{
    edgeId: 'review-04',
    tier: 'IMAGE_SUPPORTS_SAME',
    catalogItemIds: ['item-a', 'item-d'],
    reason: 'GROUPING_CONFLICT',
    blockingPairId: 'review-02',
    blockingCatalogItemIds: ['item-c', 'item-d'],
  }])
  const itemA = projection.prototypes.find((prototype) => prototype.catalogItemIds.includes('item-a'))
  assert.equal(itemA.catalogItemIds.includes('item-d'), false)
})

test('duplicate Catalog Item IDs fail before grouping', () => {
  const inputs = syntheticInputs()
  inputs.figures.items[1].id = 'item-a'
  assert.throws(() => buildPrototypeProjection(inputs), /unique, non-empty Catalog Item IDs/u)
})

test('an existing registry gives a new group an anchor ID and preserves it when membership expands', () => {
  const baseItems = [item('item-a'), item(ART_SCALE_FILTER_LEAK_ID)]
  const base = buildPrototypeProjectionState({
    figures: { count: baseItems.length, character: 'Rem', items: baseItems },
    groupingResults: { pairDecisions: [], autoMergeGroups: 0, autoMergeItems: 0 },
    imageEvidence: { reviewPairs: [] },
    generatedAt: '2026-08-10T00:00:00.000Z',
  })
  const withNewItems = [...baseItems, item('item-new')]
  const withNew = buildPrototypeProjectionState({
    figures: { count: withNewItems.length, character: 'Rem', items: withNewItems },
    groupingResults: { pairDecisions: [], autoMergeGroups: 0, autoMergeItems: 0 },
    imageEvidence: { reviewPairs: [] },
    identityRegistry: base.identityRegistry,
    generatedAt: '2026-08-11T00:00:00.000Z',
  })
  const newPrototype = withNew.projection.prototypes.find((prototype) => (
    prototype.catalogItemIds.includes('item-new')
  ))
  const expandedItems = [...withNewItems, item('item-new-color')]
  const expanded = buildPrototypeProjectionState({
    figures: { count: expandedItems.length, character: 'Rem', items: expandedItems },
    groupingResults: {
      pairDecisions: [{ decision: 'AUTO_MERGE', items: ['item-new', 'item-new-color'] }],
      autoMergeGroups: 1,
      autoMergeItems: 2,
    },
    imageEvidence: { reviewPairs: [] },
    identityRegistry: withNew.identityRegistry,
    generatedAt: '2026-08-12T00:00:00.000Z',
  })
  const expandedPrototype = expanded.projection.prototypes.find((prototype) => (
    prototype.catalogItemIds.includes('item-new')
  ))

  assert.notEqual(newPrototype.prototypeId, legacyMembershipPrototypeId(['item-new']))
  assert.equal(expandedPrototype.prototypeId, newPrototype.prototypeId)
  assert.notEqual(expandedPrototype.membershipFingerprint, newPrototype.membershipFingerprint)
  assert.deepEqual(expandedPrototype.catalogItemIds, ['item-new', 'item-new-color'])
})

test('collector loader verifies digests and writes an atomic runtime projection', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rem-projection-test-'))
  const output = path.join(root, 'runtime', 'characters', 'rem', 'prototype-projection.json')
  try {
    const inputs = syntheticInputs()
    await writeFile(path.join(root, 'figures.json'), `${JSON.stringify(inputs.figures)}\n`, 'utf8')
    await writeFile(
      path.join(root, 'prototype-grouping-results.json'),
      `${JSON.stringify(inputs.groupingResults)}\n`,
      'utf8',
    )
    await writeFile(
      path.join(root, 'prototype-review-image-evidence.json'),
      `${JSON.stringify(inputs.imageEvidence)}\n`,
      'utf8',
    )

    const projection = await buildProjectionFromCollector({
      collectorRoot: root,
      outputPath: output,
      strictFrozenBaseline: false,
    })
    const written = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(written.viewMode, 'prototype_projection')
    assert.equal(written.prototypeCount, projection.prototypeCount)
    assert.equal(written.prototypes.length, projection.prototypes.length)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('generic catalog normalization accepts CatalogItem image/source references without touching legacy input', () => {
  const legacy = { count: 1, items: [item('legacy-a')] }
  assert.equal(normalizeCharacterCatalog(legacy), legacy)
  const normalized = normalizeCharacterCatalog({
    character: '柴郡',
    characterSlug: 'cheshire',
    items: [{
      catalogItemId: 'solaris:cheshire-a',
      title: 'Synthetic Cheshire',
      images: [{ url: 'https://solarisjapan.com/example.jpg', isMain: true }],
      sourceRefs: [{ family: 'solaris', sourceId: 'a', url: 'https://solarisjapan.com/a' }],
    }],
  })
  assert.equal(normalized.count, 1)
  assert.equal(normalized.items[0].id, 'solaris:cheshire-a')
  assert.equal(normalized.items[0].image_url, 'https://solarisjapan.com/example.jpg')
  assert.deepEqual(normalized.items[0].source_urls, ['https://solarisjapan.com/a'])
  assert.equal(normalized.items[0].source, 'solaris')
})

test('generic character projection has isolated stable IDs and zero rebuild drift', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-projection-test-'))
  const output = path.join(root, 'runtime', 'characters', 'cheshire', 'prototype-projection.json')
  const catalogPath = path.join(root, 'catalog.json')
  const groupingPath = path.join(root, 'grouping.json')
  const reviewPath = path.join(root, 'review.json')
  const catalog = {
    schemaVersion: 1,
    character: '柴郡',
    characterSlug: 'cheshire',
    count: 3,
    items: [
      item('solaris:cheshire-a', { character: 'Cheshire', title: 'Cheshire Original' }),
      item('goodsmile:cheshire-a', { character: 'Cheshire', title: 'Cheshire Renewal' }),
      item(ART_SCALE_FILTER_LEAK_ID, { character: 'Cheshire', title: 'A valid Cheshire pose' }),
    ],
  }
  const grouping = {
    pairDecisions: [{
      decision: 'AUTO_MERGE',
      items: ['solaris:cheshire-a', 'goodsmile:cheshire-a'],
    }],
    autoMergeGroups: 1,
    autoMergeItems: 2,
  }
  const review = { reviewPairs: [] }
  try {
    await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`, 'utf8')
    await writeFile(groupingPath, `${JSON.stringify(grouping)}\n`, 'utf8')
    await writeFile(reviewPath, `${JSON.stringify(review)}\n`, 'utf8')
    const character = { slug: 'cheshire', displayName: '柴郡' }
    const first = await buildCharacterProjectionFromFiles({
      character,
      catalogPath,
      groupingPath,
      reviewPath,
      outputPath: output,
    })
    const second = await buildCharacterProjectionFromFiles({
      character,
      catalogPath,
      groupingPath,
      reviewPath,
      outputPath: output,
    })

    assert.equal(first.characterSlug, 'cheshire')
    assert.equal(first.prototypeCount, 2)
    assert.equal(first.projectionEligibleItemCount, 3)
    assert.equal(first.excludedCatalogItems.length, 0)
    assert.ok(first.prototypes.every((prototype) => /^cheshire-proto-[a-f\d]{16}$/u.test(
      prototype.prototypeId,
    )))
    assert.deepEqual(
      second.prototypes.map((prototype) => prototype.prototypeId),
      first.prototypes.map((prototype) => prototype.prototypeId),
    )
    assert.equal(second.identity.newPrototypeIds, 0)
    assert.equal(second.identity.activePreexistingPrototypeIds, 2)
    assert.equal(second.identity.membershipFingerprintChangedCount, 0)
    assert.throws(() => buildCharacterPrototypeProjection({
      characterSlug: 'rem',
      characterName: 'Rem',
      figures: catalog,
      groupingResults: grouping,
      imageEvidence: review,
    }), /does not match projection rem/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
