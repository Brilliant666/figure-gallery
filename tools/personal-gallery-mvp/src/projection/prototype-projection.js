import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { atomicWriteJson } from '../storage/json-files.js'

export const PROJECTION_VERSION = 'rem-prototype-projection-v1'
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

export function stablePrototypeId(catalogItemIds) {
  const sorted = [...catalogItemIds].sort()
  if (!sorted.length || new Set(sorted).size !== sorted.length) {
    throw new Error('A prototype ID requires a non-empty set of unique Catalog Item IDs.')
  }
  return `rem-proto-${sha256(JSON.stringify(sorted)).slice(0, 16)}`
}

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

function prototypeProjection(items) {
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
    prototypeId: stablePrototypeId(catalogItemIds),
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

function validateInputShape(figures, groupingResults, imageEvidence) {
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

export function buildPrototypeProjection({
  figures,
  groupingResults,
  imageEvidence,
  inputDigests = {},
  strictFrozenBaseline = false,
  generatedAt = new Date().toISOString(),
}) {
  validateInputShape(figures, groupingResults, imageEvidence)
  if (strictFrozenBaseline) assertFrozenBaseline(figures, groupingResults, imageEvidence)

  const allItemIds = new Set(figures.items.map((item) => item.id))
  const excludedItems = figures.items.filter((item) => item.id === ART_SCALE_FILTER_LEAK_ID)
  const eligibleItems = figures.items.filter((item) => item.id !== ART_SCALE_FILTER_LEAK_ID)
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
  const dangerousNegativeEdges = DANGEROUS_NEGATIVE_PAIRS.filter((edge) => (
    edgeItemIds(edge).every((id) => allItemIds.has(id))
  ))
  if (strictFrozenBaseline && dangerousNegativeEdges.length !== DANGEROUS_NEGATIVE_PAIRS.length) {
    throw new Error('A frozen dangerous negative control is missing from figures.json.')
  }
  assertKnownEndpoints(
    [...autoEdges, ...sameEdges, ...differentEdges, ...inconclusiveEdges, ...dangerousNegativeEdges],
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
  if (
    swallowedDifferentEdges.length ||
    swallowedInconclusiveEdges.length ||
    swallowedDangerousNegativeEdges.length
  ) {
    throw new Error('Projection grouping swallowed a DIFFERENT, INCONCLUSIVE, or dangerous negative relationship.')
  }

  const itemById = new Map(eligibleItems.map((item) => [item.id, item]))
  const components = new Map()
  for (const id of [...eligibleIds].sort()) {
    const root = disjointSet.find(id)
    const members = components.get(root) || []
    members.push(itemById.get(id))
    components.set(root, members)
  }
  const prototypes = [...components.values()]
    .map(prototypeProjection)
    .sort((left, right) => left.prototypeId.localeCompare(right.prototypeId))
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

  const relaxTimeCases = RELAX_TIME_CASES.map((frozenCase) => {
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

  return {
    schemaVersion: 1,
    projectionVersion: PROJECTION_VERSION,
    viewMode: 'prototype_projection',
    character: figures.character || 'Rem',
    characterSlug: 'rem',
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
    summary,
    inputs: inputDigests,
    excludedCatalogItems: excludedItems.map((item) => ({
      catalogItemId: item.id,
      title: item.title || item.id,
      projectionExcluded: true,
      reason: ART_SCALE_FILTER_LEAK_REASON,
    })),
    grouping: {
      autoMergeEdgeCount: autoEdges.length,
      appliedAutoMergeReductionCount: appliedAutoMergeEdges,
      imageSupportsSameEdgeCount: sameEdges.length,
      appliedImageSameReductionCount: appliedImageSameEdges,
      imageSupportsDifferentEdgeCount: differentEdges.length,
      imageInconclusiveEdgeCount: inconclusiveEdges.length,
      dangerousNegativePairCount: dangerousNegativeEdges.length,
      groupingConflictCount,
      rejectedEdges,
      relaxTimeCases,
    },
    prototypes,
  }
}

async function readWithDigest(filePath) {
  const bytes = await readFile(filePath)
  return { value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) }
}

export async function loadProjectionInputs(collectorRoot) {
  const root = path.resolve(collectorRoot)
  const files = {
    figures: path.join(root, 'figures.json'),
    groupingResults: path.join(root, 'prototype-grouping-results.json'),
    imageEvidence: path.join(root, 'prototype-review-image-evidence.json'),
  }
  const [figures, groupingResults, imageEvidence] = await Promise.all([
    readWithDigest(files.figures),
    readWithDigest(files.groupingResults),
    readWithDigest(files.imageEvidence),
  ])

  const expectedFigureDigest = groupingResults.value?.source?.sha256
  const evidenceDigests = imageEvidence.value?.inputs?.sha256 || {}
  if (
    expectedFigureDigest && expectedFigureDigest !== figures.sha256 ||
    evidenceDigests['figures.json'] && evidenceDigests['figures.json'] !== figures.sha256 ||
    evidenceDigests['prototype-grouping-results.json'] &&
      evidenceDigests['prototype-grouping-results.json'] !== groupingResults.sha256
  ) {
    throw new Error('Frozen Collector input digest mismatch; refusing to build a projection.')
  }

  return {
    figures: figures.value,
    groupingResults: groupingResults.value,
    imageEvidence: imageEvidence.value,
    inputDigests: {
      'figures.json': figures.sha256,
      'prototype-grouping-results.json': groupingResults.sha256,
      'prototype-review-image-evidence.json': imageEvidence.sha256,
    },
  }
}

export async function buildProjectionFromCollector({
  collectorRoot,
  outputPath,
  strictFrozenBaseline = true,
}) {
  const inputs = await loadProjectionInputs(collectorRoot)
  const projection = buildPrototypeProjection({ ...inputs, strictFrozenBaseline })
  await atomicWriteJson(path.resolve(outputPath), projection)
  return projection
}
