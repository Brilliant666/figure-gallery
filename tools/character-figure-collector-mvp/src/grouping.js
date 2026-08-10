import { groupingBaseTitle, manufacturerKey, scaleKey, structuralVariantSignature } from './semantic-title.js'
import { sha256 } from './text.js'

function pairKey(left, right) {
  return [left, right].sort().join('|')
}

function pairId(left, right) {
  return `pair-${sha256(pairKey(left, right)).slice(0, 16)}`
}

function tokens(value) {
  return new Set(String(value ?? '').split(/\s+/gu).filter(Boolean))
}

function similarity(left, right) {
  const a = tokens(left)
  const b = tokens(right)
  if (!a.size || !b.size) return 0
  const common = [...a].filter((token) => b.has(token)).length
  return common / (a.size + b.size - common)
}

function prepared(item, profile) {
  return {
    item,
    id: item.catalogItemId,
    base: groupingBaseTitle(item.title, profile, item.manufacturer),
    manufacturer: manufacturerKey(item.manufacturer),
    scale: scaleKey(item.scale),
    structural: structuralVariantSignature(item.title),
  }
}

function classify(left, right) {
  const sameMaker = Boolean(left.manufacturer && left.manufacturer === right.manufacturer)
  const titleSimilarity = similarity(left.base, right.base)
  if (left.scale && right.scale && left.scale !== right.scale && titleSimilarity >= 0.7) {
    return { decision: 'KEEP_SEPARATE', reason: 'SCALE_CONFLICT', confidence: 1 }
  }
  if (left.structural !== right.structural && titleSimilarity >= 0.45) {
    return { decision: 'KEEP_SEPARATE', reason: 'STRUCTURAL_VARIANT_CONFLICT', confidence: 1 }
  }
  if (sameMaker && left.base === right.base && tokens(left.base).size >= 2 && left.structural === right.structural) {
    return { decision: 'AUTO_MERGE', reason: 'EXACT_TEXT_FIRST_BASE', confidence: 0.99 }
  }
  if (sameMaker && titleSimilarity >= 0.5) {
    return { decision: 'REVIEW', reason: 'SIMILAR_TEXT_SAME_MANUFACTURER', confidence: Number(titleSimilarity.toFixed(4)) }
  }
  if (titleSimilarity >= 0.8) {
    return { decision: 'REVIEW', reason: 'HIGH_TEXT_SIMILARITY', confidence: Number(titleSimilarity.toFixed(4)) }
  }
  return { decision: 'UNRELATED', reason: 'NO_SAFE_RELATION', confidence: Number(titleSimilarity.toFixed(4)) }
}

class DisjointSet {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]))
  }
  find(id) {
    const parent = this.parent.get(id)
    if (parent !== id) this.parent.set(id, this.find(parent))
    return this.parent.get(id)
  }
  union(left, right) {
    const a = this.find(left)
    const b = this.find(right)
    if (a !== b) this.parent.set(b, a)
  }
  members(root) {
    return [...this.parent.keys()].filter((id) => this.find(id) === root)
  }
}

export function produceGrouping(items, profile) {
  const values = items.map((item) => prepared(item, profile)).sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const autoCandidates = []
  const review = []
  const keepSeparate = []
  let unrelatedPairCount = 0
  for (let first = 0; first < values.length; first += 1) {
    for (let second = first + 1; second < values.length; second += 1) {
      const left = values[first]
      const right = values[second]
      const result = classify(left, right)
      const pair = { leftCatalogItemId: left.id, rightCatalogItemId: right.id, ...result }
      if (result.decision === 'AUTO_MERGE') autoCandidates.push(pair)
      else if (result.decision === 'REVIEW') review.push(pair)
      else if (result.decision === 'KEEP_SEPARATE') keepSeparate.push(pair)
      else unrelatedPairCount += 1
    }
  }

  const prohibited = new Set(keepSeparate.map((pair) => pairKey(pair.leftCatalogItemId, pair.rightCatalogItemId)))
  const dsu = new DisjointSet(values.map((value) => value.id))
  const autoMerge = []
  for (const pair of autoCandidates.sort((a, b) => b.confidence - a.confidence || pairKey(a.leftCatalogItemId, a.rightCatalogItemId).localeCompare(pairKey(b.leftCatalogItemId, b.rightCatalogItemId), 'en'))) {
    const leftMembers = dsu.members(dsu.find(pair.leftCatalogItemId))
    const rightMembers = dsu.members(dsu.find(pair.rightCatalogItemId))
    const conflict = leftMembers.some((left) => rightMembers.some((right) => prohibited.has(pairKey(left, right))))
    if (conflict) review.push({ ...pair, decision: 'REVIEW', reason: 'COMPLETE_LINK_CONFLICT' })
    else {
      dsu.union(pair.leftCatalogItemId, pair.rightCatalogItemId)
      autoMerge.push(pair)
    }
  }
  const groups = [...new Set(values.map((value) => dsu.find(value.id)))]
    .map((root) => dsu.members(root).sort())
    .filter((members) => members.length > 1)
    .sort((left, right) => left[0].localeCompare(right[0], 'en'))
  review.sort((a, b) => pairKey(a.leftCatalogItemId, a.rightCatalogItemId).localeCompare(pairKey(b.leftCatalogItemId, b.rightCatalogItemId), 'en'))
  keepSeparate.sort((a, b) => pairKey(a.leftCatalogItemId, a.rightCatalogItemId).localeCompare(pairKey(b.leftCatalogItemId, b.rightCatalogItemId), 'en'))
  const pairDecisions = [...autoMerge, ...review, ...keepSeparate]
    .map((pair) => ({
      pairId: pairId(pair.leftCatalogItemId, pair.rightCatalogItemId),
      items: [{ id: pair.leftCatalogItemId }, { id: pair.rightCatalogItemId }],
      decision: pair.decision,
      reason: pair.reason,
      confidence: pair.confidence,
    }))
    .sort((left, right) => left.pairId.localeCompare(right.pairId, 'en'))
  return {
    schemaVersion: 1,
    engine: 'text-first-complete-link-v1',
    character: profile.slug,
    catalogItemCount: values.length,
    autoMerge,
    review,
    keepSeparate,
    pairDecisions,
    autoMergeGroups: groups,
    unrelatedPairCount,
    counts: {
      autoMergeEdges: autoMerge.length,
      autoMergeGroups: groups.length,
      reviewPairs: review.length,
      keepSeparatePairs: keepSeparate.length,
      unrelatedPairs: unrelatedPairCount,
    },
  }
}

export function buildReviewTemplate(grouping, items) {
  const byId = new Map(items.map((item) => [item.catalogItemId, item]))
  const reviewPairs = grouping.review.map((pair) => ({
    pairId: pairId(pair.leftCatalogItemId, pair.rightCatalogItemId),
    items: [reviewItem(byId.get(pair.leftCatalogItemId)), reviewItem(byId.get(pair.rightCatalogItemId))],
    suggestedReason: pair.reason,
    imageDecision: null,
    allowedImageDecisions: ['IMAGE_SUPPORTS_SAME', 'IMAGE_SUPPORTS_DIFFERENT', 'IMAGE_INCONCLUSIVE'],
  }))
  return {
    schemaVersion: 1,
    character: grouping.character,
    reviewPairs,
    decisions: reviewPairs,
  }
}

function reviewItem(item) {
  return {
    id: item.catalogItemId,
    catalogItemId: item.catalogItemId,
    title: item.title,
    manufacturer: item.manufacturer,
    category: item.category,
    scale: item.scale,
    images: item.images,
    sourceRefs: item.sourceRefs,
  }
}

export function buildProjectionInput(profile, items) {
  return {
    schemaVersion: 1,
    character: profile.displayName,
    characterSlug: profile.slug,
    count: items.length,
    items: items.map((item) => ({
      id: item.catalogItemId,
      title: item.title,
      manufacturer: item.manufacturer,
      category: item.category,
      scale: item.scale,
      release: item.release,
      image_url: item.images[0]?.url ?? null,
      image_urls: item.images.map((image) => image.url),
      source_urls: item.sourceRefs.map((source) => source.url),
      sources: [...new Set(item.sourceRefs.map((source) => source.family))],
      sourceRefs: item.sourceRefs,
      images: item.images,
    })),
  }
}
