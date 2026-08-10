import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ART_SCALE_FILTER_LEAK_ID,
  buildPrototypeProjectionState,
  compareByRecommendation,
  legacyMembershipPrototypeId,
} from '../../src/projection/prototype-projection.js'

function item(id) {
  return {
    id,
    character: 'Rem',
    title: `Synthetic ${id}`,
    manufacturer: 'Synthetic Maker',
    category: 'Prize',
    image_url: null,
    image_urls: [],
    source: 'Synthetic Source',
    source_urls: [],
  }
}

function syntheticConsolidation() {
  const eligibleIds = Array.from({ length: 231 }, (_, index) => `item-${String(index).padStart(3, '0')}`)
  const groupSizes = [3, 3, 3, 2, 2, 2, 2]
  let offset = 0
  const mergeGroups = groupSizes.map((size, groupIndex) => {
    const anchors = eligibleIds.slice(offset, offset + size)
    offset += size
    const members = anchors.map((anchorCatalogItemId) => ({
      baselinePrototypeId: legacyMembershipPrototypeId([anchorCatalogItemId]),
      anchorCatalogItemId,
    }))
    const survivorPrototypeId = members.map((value) => value.baselinePrototypeId).sort()[0]
    return { proposalId: `proposal-${groupIndex}`, survivorPrototypeId, members }
  })
  const aliases = Object.fromEntries(mergeGroups.flatMap((group) => group.members
    .filter((member) => member.baselinePrototypeId !== group.survivorPrototypeId)
    .map((member) => [member.baselinePrototypeId, group.survivorPrototypeId])))
  const differentRelations = Array.from({ length: 24 }, (_, index) => {
    const leftId = eligibleIds[100 + index * 2]
    const rightId = eligibleIds[101 + index * 2]
    return {
      candidateId: `different-${index}`,
      left: { baselinePrototypeId: legacyMembershipPrototypeId([leftId]), anchorCatalogItemId: leftId },
      right: { baselinePrototypeId: legacyMembershipPrototypeId([rightId]), anchorCatalogItemId: rightId },
    }
  })
  return {
    eligibleIds,
    spec: {
      mergeGroups,
      differentRelations,
      aliases,
      expected: {
        beforePrototypeCount: 231,
        mergeGroups: 7,
        prototypeCardsAffected: 17,
        retiredPrototypeIds: 10,
        afterPrototypeCount: 221,
        differentRelations: 24,
      },
    },
  }
}

test('seven approved groups reduce 231 Prototypes to 221 while all 24 DIFFERENT relations stay separate', () => {
  const { eligibleIds, spec } = syntheticConsolidation()
  const items = [...eligibleIds.map(item), item(ART_SCALE_FILTER_LEAK_ID)]
  const inputs = {
    figures: { count: items.length, character: 'Rem', items },
    groupingResults: { pairDecisions: [], autoMergeGroups: 0, autoMergeItems: 0 },
    imageEvidence: { reviewPairs: [] },
    consolidation: spec,
    generatedAt: '2026-08-10T00:00:00.000Z',
  }
  const first = buildPrototypeProjectionState(inputs)
  const second = buildPrototypeProjectionState({
    ...inputs,
    generatedAt: '2026-08-11T00:00:00.000Z',
    identityRegistry: first.identityRegistry,
  })
  const prototypeFor = (projection, catalogItemId) => projection.prototypes.find((prototype) => (
    prototype.catalogItemIds.includes(catalogItemId)
  ))

  assert.equal(first.projection.prototypeCount, 221)
  assert.equal(first.projection.grouping.remV1MergeGroupCount, 7)
  assert.equal(first.projection.grouping.remV1AppliedReductionCount, 10)
  assert.equal(first.projection.grouping.auditConfirmedDifferentPassed, 24)
  assert.equal(Object.keys(first.identityRegistry.aliases).length, 10)
  for (const relation of spec.differentRelations) {
    assert.notEqual(
      prototypeFor(first.projection, relation.left.anchorCatalogItemId).prototypeId,
      prototypeFor(first.projection, relation.right.anchorCatalogItemId).prototypeId,
    )
  }
  assert.deepEqual(
    second.projection.prototypes.map((prototype) => prototype.prototypeId),
    first.projection.prototypes.map((prototype) => prototype.prototypeId),
  )
  assert.deepEqual(
    second.projection.prototypes.map((prototype) => prototype.membershipFingerprint),
    first.projection.prototypes.map((prototype) => prototype.membershipFingerprint),
  )
  assert.deepEqual(second.identityRegistry, first.identityRegistry)
  assert.equal(first.projection.sort.mode, 'recommended')
  assert.equal(first.projection.sort.popularitySignals, 0)
})

test('recommendation tuple is deterministic, explainable, and never uses Prototype ID as quality', () => {
  const values = [
    { prototypeId: 'rem-proto-c', title: 'C', cover: null, images: [], sources: [] },
    {
      prototypeId: 'rem-proto-b',
      title: 'B',
      cover: { url: 'b' },
      images: Array.from({ length: 4 }, (_, index) => ({ sourceFamily: 'solaris', url: `b-${index}` })),
      sources: [{ sourceFamily: 'solaris' }],
    },
    {
      prototypeId: 'rem-proto-a',
      title: 'A',
      cover: { url: 'a' },
      images: Array.from({ length: 8 }, (_, index) => ({ sourceFamily: 'goodsmile', url: `a-${index}` })),
      sources: [{ sourceFamily: 'goodsmile' }],
    },
  ]
  const first = [...values].sort(compareByRecommendation).map((value) => value.prototypeId)
  const second = [...values].reverse().sort(compareByRecommendation).map((value) => value.prototypeId)

  assert.deepEqual(first, ['rem-proto-a', 'rem-proto-b', 'rem-proto-c'])
  assert.deepEqual(second, first)
})
