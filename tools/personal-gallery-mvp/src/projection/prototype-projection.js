import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { atomicWriteJson, readJson } from '../storage/json-files.js'
import {
  REM_V1_ALIASES,
  REM_V1_AUDIT_PROVENANCE,
  REM_V1_CONSOLIDATION_VERSION,
  REM_V1_DIFFERENT_RELATIONS,
  REM_V1_EXPECTED,
  REM_V1_MERGE_GROUPS,
} from './rem-v1-consolidation.js'
import {
  assignPrototypeIdentities,
  legacyMembershipPrototypeId,
  membershipFingerprint,
} from './prototype-identity.js'
import {
  migratePrototypePreferencesFile,
} from './prototype-preference-migration.js'

export const PROJECTION_VERSION = 'rem-prototype-projection-v2'
export const CHARACTER_PROJECTION_VERSION = 'character-prototype-projection-v1'
export const ART_SCALE_FILTER_LEAK_ID = 'solaris:7415437426731'
export const ART_SCALE_FILTER_LEAK_REASON = 'confirmed bust/filter leak'

const FROZEN_BASELINE = Object.freeze({
  catalogItems: 285,
  autoMergeEdges: 38,
  autoMergeGroups: 22,
  autoMergeItems: 51,
  reviewPairs: 35,
  imageSupportsSame: 27,
  imageSupportsDifferent: 6,
  imageInconclusive: 2,
})

const RELAX_TIME_CASES = Object.freeze([
  Object.freeze({
    pairId: 'review-12',
    catalogItemIds: Object.freeze(['solaris:4802786197547', 'solaris:7097079988267']),
  }),
  Object.freeze({
    pairId: 'review-28',
    catalogItemIds: Object.freeze(['solaris:7097079988267', 'solaris:7308216533035']),
  }),
])

const DANGEROUS_NEGATIVE_PAIRS = Object.freeze([
  Object.freeze({
    pairId: 'danger-bunny-vs-bunny-2nd',
    items: Object.freeze(['goodsmile:6929', 'goodsmile:9684']),
  }),
  Object.freeze({
    pairId: 'danger-bare-leg-bunny-vs-2nd',
    items: Object.freeze(['goodsmile:10783', 'goodsmile:1137281']),
  }),
  Object.freeze({
    pairId: 'danger-phantom-night-wizard-single-vs-pair',
    items: Object.freeze(['solaris:7284897382443', 'solaris:7284897546283']),
  }),
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalPair(left, right) {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`
}

function edgeItemIds(edge) {
  const items = Array.isArray(edge?.items) ? edge.items : []
  if (items.length !== 2) throw new Error('Every projection edge must contain exactly two items.')
  return items.map((item) => {
    const id = typeof item === 'string' ? item : item?.id
    if (typeof id !== 'string' || !id) throw new Error('Every projection edge item requires an ID.')
    return id
  })
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))]
}

function sourceUrlRecord(url) {
  const sourceFamily = sourceFamilyForUrl(url)
  const details = {
    goodsmile: { label: 'Good Smile', role: 'official' },
    solaris: { label: 'Solaris Japan', role: 'catalog/retailer source' },
    'japan-figure': { label: 'Japan Figure', role: 'catalog source' },
    unknown: { label: 'Unknown source', role: 'unclassified source' },
  }[sourceFamily]
  return { url, sourceFamily, ...details }
}

export function sourceFamilyForUrl(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    return 'unknown'
  }

  const host = url.hostname.toLowerCase()
  const pathname = url.pathname.toLowerCase()
  if (
    host === 'goodsmile.com' ||
    host.endsWith('.goodsmile.com') ||
    host === 'goodsmile.info' ||
    host.endsWith('.goodsmile.info')
  ) {
    return 'goodsmile'
  }
  if (host === 'solarisjapan.com' || host.endsWith('.solarisjapan.com')) return 'solaris'
  if (host === 'japan-figure.com' || host.endsWith('.japan-figure.com')) return 'japan-figure'
  if (host === 'cdn.shopify.com' && pathname.includes('/s/files/1/0318/2649/')) return 'solaris'
  if (host === 'cdn.shopify.com' && pathname.includes('/s/files/1/0568/2298/8958/')) {
    return 'japan-figure'
  }
  return 'unknown'
}

export { legacyMembershipPrototypeId, membershipFingerprint }

class DisjointSet {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]))
    this.members = new Map(ids.map((id) => [id, new Set([id])]))
  }

  has(id) {
    return this.parent.has(id)
  }

  find(id) {
    const parent = this.parent.get(id)
    if (!parent) throw new Error(`Unknown Catalog Item ID: ${id}`)
    if (parent === id) return id
    const root = this.find(parent)
    this.parent.set(id, root)
    return root
  }

  component(id) {
    return this.members.get(this.find(id))
  }

  union(left, right) {
    let leftRoot = this.find(left)
    let rightRoot = this.find(right)
    if (leftRoot === rightRoot) return false
    if (leftRoot > rightRoot) [leftRoot, rightRoot] = [rightRoot, leftRoot]
    this.parent.set(rightRoot, leftRoot)
    const leftMembers = this.members.get(leftRoot)
    for (const item of this.members.get(rightRoot)) leftMembers.add(item)
    this.members.delete(rightRoot)
    return true
  }
}

function separationBetween(disjointSet, left, right, separationPairs) {
  const leftMembers = disjointSet.component(left)
  const rightMembers = disjointSet.component(right)
  for (const leftItem of leftMembers) {
    for (const rightItem of rightMembers) {
      const separation = separationPairs.get(canonicalPair(leftItem, rightItem))
      if (separation) return { ...separation, catalogItemIds: [leftItem, rightItem] }
    }
  }
  return null
}

function imageRefsForItems(items) {
  const refsByUrl = new Map()
  for (const item of [...items].sort((left, right) => left.id.localeCompare(right.id))) {
    const urls = uniqueStrings([item.image_url, ...(item.image_urls || [])])
    for (const url of urls) {
      const candidate = {
        id: `image-ref-${sha256(url).slice(0, 16)}`,
        url,
        catalogItemId: item.id,
        sourceFamily: sourceFamilyForUrl(url),
        isMain: url === item.image_url,
      }
      const existing = refsByUrl.get(url)
      if (!existing || (!existing.isMain && candidate.isMain) || candidate.catalogItemId < existing.catalogItemId) {
        refsByUrl.set(url, candidate)
      }
    }
  }
  return [...refsByUrl.values()]
}

function automaticCover(images) {
  return images.find((image) => image.sourceFamily === 'goodsmile' && image.isMain)
    || images.find((image) => image.isMain)
    || images.find((image) => image.sourceFamily === 'goodsmile')
    || images[0]
    || null
}

export function classifyCatalogItem(item) {
  const category = String(item?.category || '').trim()
  const scale = String(item?.scale || '').trim()
  if (/^prize$/iu.test(category)) return 'likely_prize'
  const explicitlyNonScale = /non[\s-]*scale/iu.test(`${category} ${scale}`)
  const explicitlyScaled = /\b\d+\s*\/\s*\d+(?:st|nd|rd|th)?\s*(?:scale)?\b/iu.test(
    `${category} ${scale}`,
  )
  if (explicitlyScaled && !explicitlyNonScale) return 'likely_scale'
  if (/^(?:general|limited editions|pop up parade|non-scale figure|other scale)$/iu.test(category)) {
    return 'likely_static'
  }
  return 'unknown'
}

function catalogItemProjection(item) {
  const sourceUrls = uniqueStrings(item.source_urls || [])
  return {
    id: item.id,
    title: item.title || item.id,
    manufacturer: item.manufacturer || null,
    category: item.category || null,
    classification: classifyCatalogItem(item),
    scale: item.scale || null,
    release: item.release || null,
    source: item.source || null,
    sourceUrls,
    sources: sourceUrls.map(sourceUrlRecord),
  }
}

function normalizedTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .trim()
}

function imageCoverageBucket(count) {
  if (count >= 8) return 4
  if (count >= 4) return 3
  if (count >= 2) return 2
  if (count >= 1) return 1
  return 0
}

export function recommendationSignals(prototype) {
  const sourceFamilies = new Set([
    ...(prototype.images || []).map((image) => image.sourceFamily),
    ...(prototype.sources || []).map((source) => source.sourceFamily),
  ].filter((family) => family && family !== 'unknown'))
  return {
    hasCover: prototype.cover ? 1 : 0,
    imageCoverageBucket: imageCoverageBucket((prototype.images || []).length),
    sourceFamilyCount: sourceFamilies.size,
    hasGoodSmileEnrichment: sourceFamilies.has('goodsmile') ? 1 : 0,
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function compareByRecommendation(left, right) {
  const leftSignals = recommendationSignals(left)
  const rightSignals = recommendationSignals(right)
  for (const name of [
    'hasCover',
    'imageCoverageBucket',
    'sourceFamilyCount',
    'hasGoodSmileEnrichment',
  ]) {
    if (leftSignals[name] !== rightSignals[name]) return rightSignals[name] - leftSignals[name]
  }
  return compareText(normalizedTitle(left.title), normalizedTitle(right.title))
    || compareText(left.prototypeId, right.prototypeId)
}

function prototypeProjection(items, identity) {
  const sortedItems = [...items].sort((left, right) => left.id.localeCompare(right.id))
  const catalogItemIds = sortedItems.map((item) => item.id)
  const images = imageRefsForItems(sortedItems)
  const cover = automaticCover(images)
  const representative = sortedItems.find((item) => item.id === cover?.catalogItemId) || sortedItems[0]
  const sources = new Map()
  for (const item of sortedItems) {
    for (const url of uniqueStrings(item.source_urls || [])) sources.set(url, sourceUrlRecord(url))
  }
  const manufacturers = uniqueStrings(sortedItems.map((item) => item.manufacturer)).sort()
  const charactersHint = uniqueStrings(sortedItems.map((item) => item.character)).sort()
  const classifications = uniqueStrings(sortedItems.map(classifyCatalogItem)).sort()
  const classification = ['likely_scale', 'likely_prize', 'likely_static', 'unknown']
    .find((candidate) => classifications.includes(candidate)) || 'unknown'

  return {
    prototypeId: identity.prototypeId,
    membershipFingerprint: identity.membershipFingerprint,
    catalogItemIds,
    groupedCatalogItemCount: catalogItemIds.length,
    title: representative.title || representative.id,
    manufacturer: representative.manufacturer || null,
    manufacturers,
    classification,
    classifications,
    category: representative.category || null,
    charactersHint,
    cover,
    images,
    catalogItems: sortedItems.map(catalogItemProjection),
    sources: [...sources.values()].sort((left, right) => left.url.localeCompare(right.url)),
  }
}

export function normalizeCharacterCatalog(figures) {
  if (!Array.isArray(figures?.items)) return figures
  const requiresNormalization = figures.items.some((item) => (
    typeof item?.id !== 'string' ||
    !item.id ||
    (Array.isArray(item.images) && !Array.isArray(item.image_urls)) ||
    (Array.isArray(item.sourceRefs) && !Array.isArray(item.source_urls))
  ))
  if (!requiresNormalization) return figures
  const items = figures.items.map((item) => {
    const id = String(item?.id || item?.catalogItemId || '').trim()
    const images = Array.isArray(item?.images) ? item.images : []
    const imageUrls = uniqueStrings([
      item?.image_url,
      ...(item?.image_urls || []),
      ...images.map((image) => image?.url),
    ])
    const mainImage = images.find((image) => image?.isMain && image?.url)?.url || imageUrls[0] || null
    const sourceRefs = Array.isArray(item?.sourceRefs) ? item.sourceRefs : []
    const sourceUrls = uniqueStrings([
      ...(item?.source_urls || []),
      ...sourceRefs.map((source) => source?.url),
    ])
    return {
      ...item,
      id,
      image_url: mainImage,
      image_urls: imageUrls,
      source_urls: sourceUrls,
      source: item?.source || uniqueStrings(sourceRefs.map((source) => source?.family)).join(', ') || null,
    }
  })
  return { ...figures, count: figures.count ?? items.length, items }
}

function validateInputShape(figures, groupingResults, imageEvidence, characterSlug = null) {
  if (!Array.isArray(figures?.items)) throw new Error('figures.json must contain an items array.')
  if (!Array.isArray(groupingResults?.pairDecisions)) {
    throw new Error('prototype-grouping-results.json must contain pairDecisions.')
  }
  if (!Array.isArray(imageEvidence?.reviewPairs)) {
    throw new Error('prototype-review-image-evidence.json must contain reviewPairs.')
  }
  const ids = figures.items.map((item) => item?.id)
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    throw new Error('figures.json requires unique, non-empty Catalog Item IDs.')
  }
  if (Number(figures.count) !== figures.items.length) {
    throw new Error('figures.json count does not match its items array.')
  }
  if (figures.characterSlug && characterSlug && figures.characterSlug !== characterSlug) {
    throw new Error(
      `Catalog characterSlug ${figures.characterSlug} does not match projection ${characterSlug}.`,
    )
  }
}

function frozenBaselineCounts(groupingResults, imageEvidence) {
  const autoMergeEdges = groupingResults.pairDecisions.filter(
    (edge) => edge.decision === 'AUTO_MERGE',
  ).length
  const imageDecisionCounts = imageEvidence.reviewPairs.reduce((counts, edge) => {
    counts[edge.imageDecision] = (counts[edge.imageDecision] || 0) + 1
    return counts
  }, {})
  return {
    autoMergeEdges,
    autoMergeGroups: Number(groupingResults.autoMergeGroups),
    autoMergeItems: Number(groupingResults.autoMergeItems),
    reviewPairs: imageEvidence.reviewPairs.length,
    imageSupportsSame: imageDecisionCounts.IMAGE_SUPPORTS_SAME || 0,
    imageSupportsDifferent: imageDecisionCounts.IMAGE_SUPPORTS_DIFFERENT || 0,
    imageInconclusive: imageDecisionCounts.IMAGE_INCONCLUSIVE || 0,
  }
}

function assertFrozenBaseline(figures, groupingResults, imageEvidence) {
  const actual = {
    catalogItems: figures.items.length,
    ...frozenBaselineCounts(groupingResults, imageEvidence),
  }
  for (const [name, expected] of Object.entries(FROZEN_BASELINE)) {
    if (actual[name] !== expected) {
      throw new Error(`Frozen Collector baseline mismatch for ${name}: ${actual[name]} != ${expected}.`)
    }
  }
  if (!figures.items.some((item) => item.id === ART_SCALE_FILTER_LEAK_ID)) {
    throw new Error(`Frozen ArtScale filter leak is missing: ${ART_SCALE_FILTER_LEAK_ID}.`)
  }
}

function assertKnownEndpoints(edges, catalogItemIds, label) {
  for (const edge of edges) {
    for (const id of edgeItemIds(edge)) {
      if (!catalogItemIds.has(id)) throw new Error(`${label} references unknown Catalog Item ID: ${id}`)
    }
  }
}

export function buildCharacterPrototypeProjectionState({
  characterSlug,
  characterName,
  figures,
  groupingResults,
  imageEvidence,
  identityRegistry = null,
  consolidation = null,
  exclusions = [],
  dangerousNegativePairs = [],
  relaxTimeCases = [],
  legacyIdentityBootstrap = false,
  strictConsolidation = false,
  projectionVersion = CHARACTER_PROJECTION_VERSION,
  inputDigests = {},
  generatedAt = new Date().toISOString(),
}) {
  if (!characterSlug) throw new Error('Character projection requires characterSlug.')
  figures = normalizeCharacterCatalog(figures)
  validateInputShape(figures, groupingResults, imageEvidence, characterSlug)

  const allItemIds = new Set(figures.items.map((item) => item.id))
  const exclusionById = new Map(exclusions.map((value) => [value.catalogItemId, value]))
  const excludedItems = figures.items.filter((item) => exclusionById.has(item.id))
  const eligibleItems = figures.items.filter((item) => !exclusionById.has(item.id))
  const eligibleIds = new Set(eligibleItems.map((item) => item.id))

  const autoEdges = groupingResults.pairDecisions
    .filter((edge) => edge.decision === 'AUTO_MERGE')
    .map((edge) => ({ ...edge, edgeId: canonicalPair(...edgeItemIds(edge)) }))
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId))
  const sameEdges = imageEvidence.reviewPairs
    .filter((edge) => edge.imageDecision === 'IMAGE_SUPPORTS_SAME')
    .map((edge) => ({ ...edge, edgeId: edge.pairId }))
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId))
  const differentEdges = imageEvidence.reviewPairs.filter(
    (edge) => edge.imageDecision === 'IMAGE_SUPPORTS_DIFFERENT',
  )
  const inconclusiveEdges = imageEvidence.reviewPairs.filter(
    (edge) => edge.imageDecision === 'IMAGE_INCONCLUSIVE',
  )
  const auditDifferentEdges = (consolidation?.differentRelations || []).map((relation) => ({
    pairId: relation.candidateId,
    items: [relation.left.anchorCatalogItemId, relation.right.anchorCatalogItemId],
  }))
  const dangerousNegativeEdges = dangerousNegativePairs.filter((edge) => (
    edgeItemIds(edge).every((id) => allItemIds.has(id))
  ))
  assertKnownEndpoints(
    [
      ...autoEdges,
      ...sameEdges,
      ...differentEdges,
      ...inconclusiveEdges,
      ...auditDifferentEdges,
      ...dangerousNegativeEdges,
    ],
    allItemIds,
    'Grouping edge',
  )

  const separations = new Map()
  for (const edge of dangerousNegativeEdges) {
    const [left, right] = edgeItemIds(edge)
    separations.set(canonicalPair(left, right), { kind: 'DANGEROUS_NEGATIVE', pairId: edge.pairId })
  }
  for (const edge of differentEdges) {
    const [left, right] = edgeItemIds(edge)
    separations.set(canonicalPair(left, right), { kind: 'DIFFERENT', pairId: edge.pairId })
  }
  for (const edge of auditDifferentEdges) {
    const [left, right] = edgeItemIds(edge)
    separations.set(canonicalPair(left, right), { kind: 'AUDIT_DIFFERENT', pairId: edge.pairId })
  }
  for (const edge of inconclusiveEdges) {
    const [left, right] = edgeItemIds(edge)
    separations.set(canonicalPair(left, right), { kind: 'INCONCLUSIVE', pairId: edge.pairId })
  }

  const disjointSet = new DisjointSet([...eligibleIds])
  const rejectedEdges = []
  let appliedAutoMergeEdges = 0
  let appliedImageSameEdges = 0

  const applyEdges = (edges, tier) => {
    for (const edge of edges) {
      const [left, right] = edgeItemIds(edge)
      if (!eligibleIds.has(left) || !eligibleIds.has(right)) continue
      if (disjointSet.find(left) === disjointSet.find(right)) continue
      const separation = separationBetween(disjointSet, left, right, separations)
      if (separation) {
        rejectedEdges.push({
          edgeId: edge.edgeId,
          tier,
          catalogItemIds: [left, right],
          reason: separation.kind === 'INCONCLUSIVE' ? 'INCONCLUSIVE_BLOCK' : 'GROUPING_CONFLICT',
          blockingPairId: separation.pairId,
          blockingCatalogItemIds: separation.catalogItemIds,
        })
        continue
      }
      if (disjointSet.union(left, right)) {
        if (tier === 'AUTO_MERGE') appliedAutoMergeEdges += 1
        else appliedImageSameEdges += 1
      }
    }
  }
  applyEdges(autoEdges, 'AUTO_MERGE')
  applyEdges(sameEdges, 'IMAGE_SUPPORTS_SAME')

  const swallowedDifferentEdges = differentEdges.filter((edge) => {
    const [left, right] = edgeItemIds(edge)
    return eligibleIds.has(left) && eligibleIds.has(right) && disjointSet.find(left) === disjointSet.find(right)
  })
  const swallowedInconclusiveEdges = inconclusiveEdges.filter((edge) => {
    const [left, right] = edgeItemIds(edge)
    return eligibleIds.has(left) && eligibleIds.has(right) && disjointSet.find(left) === disjointSet.find(right)
  })
  const swallowedDangerousNegativeEdges = dangerousNegativeEdges.filter((edge) => {
    const [left, right] = edgeItemIds(edge)
    return eligibleIds.has(left) && eligibleIds.has(right) && disjointSet.find(left) === disjointSet.find(right)
  })
  const swallowedAuditDifferentEdges = auditDifferentEdges.filter((edge) => {
    const [left, right] = edgeItemIds(edge)
    return eligibleIds.has(left) && eligibleIds.has(right) && disjointSet.find(left) === disjointSet.find(right)
  })
  if (
    swallowedDifferentEdges.length ||
    swallowedInconclusiveEdges.length ||
    swallowedAuditDifferentEdges.length ||
    swallowedDangerousNegativeEdges.length
  ) {
    throw new Error('Projection grouping swallowed a DIFFERENT, INCONCLUSIVE, audited DIFFERENT, or dangerous negative relationship.')
  }

  const itemById = new Map(eligibleItems.map((item) => [item.id, item]))
  const baselineIdentityByItem = new Map()
  const baselineFingerprintByPrototypeId = new Map()
  const baselineComponents = new Map()
  for (const id of [...eligibleIds].sort()) {
    const root = disjointSet.find(id)
    const members = baselineComponents.get(root) || []
    members.push(id)
    baselineComponents.set(root, members)
  }
  for (const members of baselineComponents.values()) {
    const baselinePrototypeId = legacyMembershipPrototypeId(members, { characterSlug })
    baselineFingerprintByPrototypeId.set(baselinePrototypeId, membershipFingerprint(members))
    for (const id of members) baselineIdentityByItem.set(id, baselinePrototypeId)
  }

  let appliedConsolidationReductionCount = 0
  if (consolidation) {
    const affectedBaselineIds = new Set(
      consolidation.mergeGroups.flatMap((group) => group.members.map((member) => member.baselinePrototypeId)),
    )
    if (
      consolidation.mergeGroups.length !== consolidation.expected.mergeGroups ||
      affectedBaselineIds.size !== consolidation.expected.prototypeCardsAffected ||
      Object.keys(consolidation.aliases).length !== consolidation.expected.retiredPrototypeIds ||
      auditDifferentEdges.length !== consolidation.expected.differentRelations
    ) {
      throw new Error('Rem v1 consolidation specification summary mismatch.')
    }
    if (strictConsolidation && baselineComponents.size !== consolidation.expected.beforePrototypeCount) {
      throw new Error(
        `Rem v1 pre-consolidation count mismatch: ${baselineComponents.size} != ${consolidation.expected.beforePrototypeCount}.`,
      )
    }
    for (const relation of consolidation.differentRelations) {
      for (const endpoint of [relation.left, relation.right]) {
        const baselinePrototypeId = baselineIdentityByItem.get(endpoint.anchorCatalogItemId)
        if (strictConsolidation && baselinePrototypeId !== endpoint.baselinePrototypeId) {
          throw new Error(
            `Rem v1 DIFFERENT baseline identity mismatch for ${endpoint.anchorCatalogItemId}: ` +
            `${baselinePrototypeId} != ${endpoint.baselinePrototypeId}.`,
          )
        }
      }
    }

    for (const group of consolidation.mergeGroups) {
      const members = group.members.map((member) => {
        if (!eligibleIds.has(member.anchorCatalogItemId)) {
          throw new Error(`Rem v1 consolidation anchor is unavailable: ${member.anchorCatalogItemId}.`)
        }
        const baselinePrototypeId = baselineIdentityByItem.get(member.anchorCatalogItemId)
        if (strictConsolidation && baselinePrototypeId !== member.baselinePrototypeId) {
          throw new Error(
            `Rem v1 baseline identity mismatch for ${member.anchorCatalogItemId}: ` +
            `${baselinePrototypeId} != ${member.baselinePrototypeId}.`,
          )
        }
        return member.anchorCatalogItemId
      })
      const [first, ...rest] = members
      for (const candidate of rest) {
        if (disjointSet.find(first) === disjointSet.find(candidate)) continue
        const separation = separationBetween(disjointSet, first, candidate, separations)
        if (separation) {
          throw new Error(
            `Rem v1 proposal ${group.proposalId} conflicts with ${separation.kind} ${separation.pairId}.`,
          )
        }
        if (disjointSet.union(first, candidate)) appliedConsolidationReductionCount += 1
      }
    }
  }

  const auditedDifferentPassed = auditDifferentEdges.filter((edge) => {
    const [left, right] = edgeItemIds(edge)
    return disjointSet.find(left) !== disjointSet.find(right)
  }).length
  if (auditedDifferentPassed !== auditDifferentEdges.length) {
    throw new Error('A confirmed DIFFERENT audit relation was merged by Rem v1 consolidation.')
  }

  const components = new Map()
  for (const id of [...eligibleIds].sort()) {
    const root = disjointSet.find(id)
    const members = components.get(root) || []
    members.push(itemById.get(id))
    components.set(root, members)
  }
  if (strictConsolidation && consolidation && components.size !== consolidation.expected.afterPrototypeCount) {
    throw new Error(
      `Rem v1 post-consolidation count mismatch: ${components.size} != ${consolidation.expected.afterPrototypeCount}.`,
    )
  }

  const identityGroups = [...components.values()].map((items) => ({
    catalogItemIds: items.map((item) => item.id),
  }))
  const bootstrapPrototypeIds = {}
  const forcedPrototypeIds = {}
  const legacyBootstrapAllowed = legacyIdentityBootstrap && (
    !identityRegistry || Object.keys(identityRegistry.prototypes || {}).length === 0
  )
  for (const group of identityGroups) {
    const fingerprint = membershipFingerprint(group.catalogItemIds)
    const baselineIds = [...new Set(group.catalogItemIds.map((id) => baselineIdentityByItem.get(id)))].sort()
    if (legacyBootstrapAllowed) bootstrapPrototypeIds[fingerprint] = baselineIds[0]
    const approvedGroup = consolidation?.mergeGroups.find((candidate) => (
      candidate.members.every((member) => group.catalogItemIds.includes(member.anchorCatalogItemId))
    ))
    if (approvedGroup) forcedPrototypeIds[fingerprint] = approvedGroup.survivorPrototypeId
  }
  const identityState = assignPrototypeIdentities({
    groups: identityGroups,
    characterSlug,
    previousRegistry: identityRegistry,
    bootstrapPrototypeIds,
    forcedPrototypeIds,
    aliases: consolidation?.aliases || {},
  })
  const prototypes = [...components.values()]
    .map((items) => {
      const fingerprint = membershipFingerprint(items.map((item) => item.id))
      return prototypeProjection(items, identityState.assignments.get(fingerprint))
    })
    .sort(compareByRecommendation)
  const prototypeIds = new Set(prototypes.map((prototype) => prototype.prototypeId))
  if (prototypeIds.size !== prototypes.length) throw new Error('Deterministic Prototype ID collision detected.')

  const imageProvenance = { goodsmile: 0, solaris: 0, 'japan-figure': 0, unknown: 0 }
  for (const prototype of prototypes) {
    for (const image of prototype.images) imageProvenance[image.sourceFamily] += 1
  }
  const singletonPrototypeCount = prototypes.filter(
    (prototype) => prototype.catalogItemIds.length === 1,
  ).length
  const multiItemPrototypeCount = prototypes.length - singletonPrototypeCount
  const largestPrototypeGroupSize = Math.max(0, ...prototypes.map(
    (prototype) => prototype.catalogItemIds.length,
  ))
  const groupingConflictCount = rejectedEdges.filter(
    (edge) => edge.reason === 'GROUPING_CONFLICT',
  ).length
  const manufacturerCount = new Set(
    eligibleItems.map((item) => item.manufacturer).filter(Boolean),
  ).size
  const imageRefCount = prototypes.reduce((total, prototype) => total + prototype.images.length, 0)
  const prototypeWithImageCount = prototypes.filter((prototype) => prototype.cover).length

  const evaluatedRelaxTimeCases = relaxTimeCases.map((frozenCase) => {
    const edge = inconclusiveEdges.find((candidate) => candidate.pairId === frozenCase.pairId)
    const catalogItemIds = edge ? edgeItemIds(edge) : [...frozenCase.catalogItemIds]
    const sourceFamilies = Object.fromEntries(catalogItemIds.map((id) => {
      const item = itemById.get(id)
      return [id, uniqueStrings([item?.image_url, ...(item?.image_urls || [])])
        .map(sourceFamilyForUrl)
        .filter((family, index, values) => values.indexOf(family) === index)
        .sort()]
    }))
    return {
      pairId: frozenCase.pairId,
      catalogItemIds,
      result: 'IMAGE_INCONCLUSIVE',
      projectionAction: 'kept_separate',
      sourceFamilies,
      reason: 'Minimal ImageRef provenance identifies mixed source families but not a safe item-level sculpt identity.',
    }
  })

  const summary = {
    catalogItemCount: figures.items.length,
    projectionEligibleCount: eligibleItems.length,
    prototypeCount: prototypes.length,
    singletonPrototypeCount,
    multiItemPrototypeCount,
    largestPrototypeGroupSize,
    catalogItemsCollapsed: eligibleItems.length - prototypes.length,
    groupingConflictCount,
    imageCount: imageRefCount,
    prototypeWithImageCount,
    manufacturerCount,
    imageProvenance,
  }
  const priorFingerprints = identityRegistry
    ? new Map(Object.values(identityRegistry.prototypes || {}).map((entry) => (
      [entry.prototypeId, entry.membershipFingerprint]
    )))
    : legacyIdentityBootstrap ? baselineFingerprintByPrototypeId : new Map()
  const membershipFingerprintChangedCount = prototypes.filter((prototype) => {
    const baseline = priorFingerprints.get(prototype.prototypeId)
    return baseline && baseline !== prototype.membershipFingerprint
  }).length
  const baselinePrototypeIds = new Set(priorFingerprints.keys())
  const activePreexistingPrototypeIds = prototypes.filter((prototype) => (
    baselinePrototypeIds.has(prototype.prototypeId)
  )).length

  const projection = {
    schemaVersion: 2,
    projectionVersion,
    viewMode: 'prototype_projection',
    character: characterName || figures.character || characterSlug,
    characterSlug,
    generatedAt,
    sourceCatalogItemCount: summary.catalogItemCount,
    projectionEligibleItemCount: summary.projectionEligibleCount,
    prototypeCount: summary.prototypeCount,
    singletonPrototypeCount,
    multiItemPrototypeCount,
    largestPrototypeGroupSize,
    catalogItemsCollapsed: summary.catalogItemsCollapsed,
    groupingConflictCount,
    imageRefCount,
    prototypeWithImageCount,
    imageProvenanceCounts: imageProvenance,
    prototypeAliases: identityState.registry.aliases,
    identity: {
      registrySchemaVersion: identityState.registry.schemaVersion,
      activePreexistingPrototypeIds,
      retiredPrototypeIds: Object.keys(identityState.registry.aliases).length,
      newPrototypeIds: prototypes.length - activePreexistingPrototypeIds,
      membershipFingerprintChangedCount,
    },
    sort: {
      mode: 'recommended',
      label: '推荐',
      semantics: 'reference_data_completeness',
      signals: [
        'hasCover DESC',
        'imageCoverageBucket DESC',
        'sourceFamilyCount DESC',
        'hasGoodSmileEnrichment DESC',
        'normalizedTitle ASC',
        'prototypeId ASC',
      ],
      popularitySignals: 0,
    },
    summary,
    inputs: inputDigests,
    excludedCatalogItems: excludedItems.map((item) => ({
      catalogItemId: item.id,
      title: item.title || item.id,
      projectionExcluded: true,
      reason: exclusionById.get(item.id)?.reason || 'projection exclusion',
    })),
    grouping: {
      autoMergeEdgeCount: autoEdges.length,
      appliedAutoMergeReductionCount: appliedAutoMergeEdges,
      imageSupportsSameEdgeCount: sameEdges.length,
      appliedImageSameReductionCount: appliedImageSameEdges,
      imageSupportsDifferentEdgeCount: differentEdges.length,
      imageInconclusiveEdgeCount: inconclusiveEdges.length,
      auditConfirmedDifferentRelationCount: auditDifferentEdges.length,
      auditConfirmedDifferentPassed: auditedDifferentPassed,
      remV1MergeGroupCount: consolidation?.mergeGroups.length || 0,
      remV1AppliedReductionCount: appliedConsolidationReductionCount,
      dangerousNegativePairCount: dangerousNegativeEdges.length,
      groupingConflictCount,
      rejectedEdges,
      relaxTimeCases: evaluatedRelaxTimeCases,
    },
    prototypes,
  }
  return { projection, identityRegistry: identityState.registry }
}

export function buildCharacterPrototypeProjection(options) {
  return buildCharacterPrototypeProjectionState(options).projection
}

export function buildPrototypeProjectionState({
  figures,
  groupingResults,
  imageEvidence,
  strictFrozenBaseline = false,
  ...options
}) {
  validateInputShape(figures, groupingResults, imageEvidence, 'rem')
  if (strictFrozenBaseline) assertFrozenBaseline(figures, groupingResults, imageEvidence)
  return buildCharacterPrototypeProjectionState({
    ...options,
    figures,
    groupingResults,
    imageEvidence,
    characterSlug: 'rem',
    characterName: figures.character || 'Rem',
    exclusions: [{
      catalogItemId: ART_SCALE_FILTER_LEAK_ID,
      reason: ART_SCALE_FILTER_LEAK_REASON,
    }],
    dangerousNegativePairs: DANGEROUS_NEGATIVE_PAIRS,
    relaxTimeCases: RELAX_TIME_CASES,
    legacyIdentityBootstrap: true,
    strictConsolidation: strictFrozenBaseline,
    projectionVersion: PROJECTION_VERSION,
  })
}

export function buildPrototypeProjection(options) {
  return buildPrototypeProjectionState(options).projection
}

async function readWithDigest(filePath) {
  const bytes = await readFile(filePath)
  return { value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) }
}

export async function loadCharacterProjectionInputs({
  catalogPath,
  groupingPath,
  reviewPath,
  verifyDigests = true,
}) {
  const files = {
    catalog: path.resolve(catalogPath),
    grouping: path.resolve(groupingPath),
    review: path.resolve(reviewPath),
  }
  const [catalog, grouping, review] = await Promise.all([
    readWithDigest(files.catalog),
    readWithDigest(files.grouping),
    readWithDigest(files.review),
  ])
  const evidenceDigests = review.value?.inputs?.sha256 || {}
  const expectedCatalogDigest = grouping.value?.source?.sha256
  const catalogKeys = ['figures.json', path.basename(files.catalog)]
  const groupingKeys = ['prototype-grouping-results.json', path.basename(files.grouping)]
  const recordedCatalogDigest = catalogKeys.map((key) => evidenceDigests[key]).find(Boolean)
  const recordedGroupingDigest = groupingKeys.map((key) => evidenceDigests[key]).find(Boolean)
  if (verifyDigests && (
    expectedCatalogDigest && expectedCatalogDigest !== catalog.sha256 ||
    recordedCatalogDigest && recordedCatalogDigest !== catalog.sha256 ||
    recordedGroupingDigest && recordedGroupingDigest !== grouping.sha256
  )) {
    throw new Error('Projection input digest mismatch; refusing to build a projection.')
  }
  return {
    figures: catalog.value,
    groupingResults: grouping.value,
    imageEvidence: review.value,
    inputDigests: {
      [path.basename(files.catalog)]: catalog.sha256,
      [path.basename(files.grouping)]: grouping.sha256,
      [path.basename(files.review)]: review.sha256,
    },
  }
}

export async function loadProjectionInputs(collectorRoot) {
  const root = path.resolve(collectorRoot)
  return loadCharacterProjectionInputs({
    catalogPath: path.join(root, 'figures.json'),
    groupingPath: path.join(root, 'prototype-grouping-results.json'),
    reviewPath: path.join(root, 'prototype-review-image-evidence.json'),
  })
}

export async function buildCharacterProjectionFromFiles({
  character,
  catalogPath,
  groupingPath,
  reviewPath,
  outputPath,
  identityRegistryPath = path.join(path.dirname(path.resolve(outputPath)), 'prototype-identities.json'),
  preferencesPath = path.join(path.dirname(path.resolve(outputPath)), 'preferences.json'),
  catalogPreferenceMapPath = null,
  exclusions = [],
}) {
  if (!character?.slug || !character?.displayName) {
    throw new Error('Character projection requires a resolved Character Profile.')
  }
  const resolvedOutputPath = path.resolve(outputPath)
  const resolvedRegistryPath = path.resolve(identityRegistryPath)
  const resolvedPreferencesPath = path.resolve(preferencesPath)
  const inputs = await loadCharacterProjectionInputs({ catalogPath, groupingPath, reviewPath })
  const previousRegistry = await readJson(resolvedRegistryPath)
  const catalogPreferenceMap = catalogPreferenceMapPath
    ? await readJson(path.resolve(catalogPreferenceMapPath))
    : null
  if (catalogPreferenceMapPath && !catalogPreferenceMap) {
    throw new Error('Legacy preference mapping file was not found.')
  }
  const state = buildCharacterPrototypeProjectionState({
    ...inputs,
    characterSlug: character.slug,
    characterName: character.displayName,
    identityRegistry: previousRegistry,
    exclusions,
  })
  const preferenceMigration = await migratePrototypePreferencesFile({
    preferencesPath: resolvedPreferencesPath,
    aliases: state.identityRegistry.aliases,
    prototypes: state.projection.prototypes,
    catalogPreferenceMap,
    backupLabel: 'character-prototype-projection',
  })
  await atomicWriteJson(resolvedRegistryPath, state.identityRegistry)
  await atomicWriteJson(resolvedOutputPath, state.projection)
  Object.defineProperty(state.projection, 'buildResult', {
    enumerable: false,
    value: {
      identityRegistryPath: resolvedRegistryPath,
      preferenceMigration: preferenceMigration.summary,
      preferenceBackup: preferenceMigration.backup,
    },
  })
  return state.projection
}

export async function buildProjectionFromCollector({
  collectorRoot,
  outputPath,
  identityRegistryPath = path.join(path.dirname(path.resolve(outputPath)), 'prototype-identities.json'),
  preferencesPath = path.join(path.dirname(path.resolve(outputPath)), 'preferences.json'),
  strictFrozenBaseline = true,
  applyRemV1Consolidation = strictFrozenBaseline,
}) {
  const resolvedOutputPath = path.resolve(outputPath)
  const resolvedRegistryPath = path.resolve(identityRegistryPath)
  const resolvedPreferencesPath = path.resolve(preferencesPath)
  const inputs = await loadProjectionInputs(collectorRoot)
  const previousRegistry = await readJson(resolvedRegistryPath)
  const consolidation = applyRemV1Consolidation ? {
    version: REM_V1_CONSOLIDATION_VERSION,
    auditProvenance: REM_V1_AUDIT_PROVENANCE,
    mergeGroups: REM_V1_MERGE_GROUPS,
    differentRelations: REM_V1_DIFFERENT_RELATIONS,
    aliases: REM_V1_ALIASES,
    expected: REM_V1_EXPECTED,
  } : null
  const state = buildPrototypeProjectionState({
    ...inputs,
    identityRegistry: previousRegistry,
    consolidation,
    strictFrozenBaseline,
  })
  const projection = consolidation ? {
    ...state.projection,
    consolidation: {
      version: REM_V1_CONSOLIDATION_VERSION,
      auditProvenance: REM_V1_AUDIT_PROVENANCE,
      beforePrototypeCount: REM_V1_EXPECTED.beforePrototypeCount,
      afterPrototypeCount: state.projection.prototypeCount,
      mergeGroupsApplied: REM_V1_MERGE_GROUPS.length,
      prototypeCardsAffected: REM_V1_EXPECTED.prototypeCardsAffected,
    },
  } : state.projection

  const preferenceMigration = await migratePrototypePreferencesFile({
    preferencesPath: resolvedPreferencesPath,
    aliases: state.identityRegistry.aliases,
    prototypes: projection.prototypes,
  })
  await atomicWriteJson(resolvedRegistryPath, state.identityRegistry)
  await atomicWriteJson(resolvedOutputPath, projection)
  Object.defineProperty(projection, 'buildResult', {
    enumerable: false,
    value: {
      identityRegistryPath: resolvedRegistryPath,
      preferenceMigration: preferenceMigration.summary,
      preferenceBackup: preferenceMigration.backup,
    },
  })
  return projection
}
