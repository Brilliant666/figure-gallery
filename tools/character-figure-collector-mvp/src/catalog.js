import { clean, compact, normalized, sha256, unique } from './text.js'
import { semanticMergeCompatible } from './semantic-title.js'

export const BUSINESS_DIGEST_VERSION = 2

function sourceKey(source) {
  return `${normalized(source.family)}:${normalized(source.sourceId || source.url)}`
}

function canonicalStrings(values = []) {
  return unique(values).sort((left, right) => left.localeCompare(right, 'en'))
}

function canonicalImages(images = []) {
  const byIdentity = new Map()
  for (const image of images) {
    const url = clean(image?.url)
    if (!url) continue
    const sourceFamily = normalized(image?.sourceFamily)
    byIdentity.set(`${url}\u0000${sourceFamily}`, { url, sourceFamily })
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.url.localeCompare(right.url, 'en') || left.sourceFamily.localeCompare(right.sourceFamily, 'en'),
  )
}

function canonicalSourceRefs(sourceRefs = []) {
  const byIdentity = new Map()
  for (const source of sourceRefs) {
    const value = {
      family: normalized(source?.family),
      sourceId: clean(source?.sourceId),
      url: clean(source?.url),
    }
    if (!value.family || (!value.sourceId && !value.url)) continue
    byIdentity.set(`${value.family}\u0000${value.sourceId || value.url}\u0000${value.url}`, value)
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.family.localeCompare(right.family, 'en') ||
    left.sourceId.localeCompare(right.sourceId, 'en') ||
    left.url.localeCompare(right.url, 'en'),
  )
}

export function businessDigest(item) {
  const business = {
    characterId: clean(item.characterId),
    characterSlug: normalized(item.characterSlug),
    title: clean(item.title),
    series: clean(item.series),
    manufacturer: clean(item.manufacturer),
    category: clean(item.category),
    description: clean(item.description),
    scale: item.scale == null ? null : clean(item.scale),
    heightMm: item.heightMm == null ? null : Number(item.heightMm),
    release: clean(item.release),
    productType: clean(item.productType),
    tags: canonicalStrings(item.tags),
    images: canonicalImages(item.images),
    sourceRefs: canonicalSourceRefs(item.sourceRefs),
    available: typeof item.available === 'boolean' ? item.available : null,
  }
  return sha256(JSON.stringify(business))
}

function combineRecords(records, existingId = null, timestamps = {}) {
  const sorted = [...records].sort((left, right) => sourceKey(left.sourceRefs[0]).localeCompare(sourceKey(right.sourceRefs[0]), 'en'))
  const richest = [...sorted].sort((left, right) =>
    (right.images?.length ?? 0) - (left.images?.length ?? 0) ||
    (right.description?.length ?? 0) - (left.description?.length ?? 0),
  )[0]
  const sourceRefs = [...new Map(sorted.flatMap((record) => record.sourceRefs).map((source) => [sourceKey(source), source])).values()]
    .sort((left, right) => sourceKey(left).localeCompare(sourceKey(right), 'en'))
  const images = [...new Map(sorted.flatMap((record) => record.images ?? []).map((image) => [image.url, image])).values()]
    .sort((left, right) => left.url.localeCompare(right.url, 'en'))
  const catalogItemId = existingId || `catalog-${sha256(sourceRefs.map(sourceKey).join('|')).slice(0, 16)}`
  const result = {
    schemaVersion: 1,
    catalogItemId,
    characterId: richest.characterId,
    characterSlug: richest.characterSlug,
    title: richest.title,
    series: richest.series,
    manufacturer: richest.manufacturer,
    category: richest.category,
    description: richest.description,
    scale: richest.scale,
    heightMm: richest.heightMm,
    release: richest.release,
    productType: richest.productType,
    tags: unique(sorted.flatMap((record) => record.tags ?? [])).sort((a, b) => a.localeCompare(b, 'en')),
    images,
    sourceRefs,
    available: sorted.some((record) => record.available === true) ? true : (sorted.every((record) => record.available === false) ? false : null),
    sourceUpdatedAt: sorted.map((record) => record.sourceUpdatedAt).filter(Boolean).sort().at(-1) ?? null,
    profilePoseExclusion: sorted.map((record) => record.profilePoseExclusion).find(Boolean) ?? null,
    sourcePoseExclusion: sorted.map((record) => record.sourcePoseExclusion).find(Boolean) ?? null,
    semanticTitle: richest.semanticTitle,
    manufacturerKey: richest.manufacturerKey,
    structuralVariantSignature: richest.structuralVariantSignature,
    firstSeenAt: timestamps.firstSeenAt ?? null,
    lastSeenAt: timestamps.lastSeenAt ?? null,
  }
  result.businessDigestVersion = BUSINESS_DIGEST_VERSION
  result.businessDigest = businessDigest(result)
  // Keep the historical field while runtime files transition to the explicit
  // business digest contract. Consumers should prefer businessDigest.
  result.digest = result.businessDigest
  return result
}

function asSourceRecord(item) {
  return item.sourceRefs.map((sourceRef) => ({ ...item, sourceRefs: [sourceRef], images: (item.images ?? []).filter((image) => !image.sourceFamily || image.sourceFamily === sourceRef.family) }))
}

export function mergeCatalog(existingItems = [], incomingRecords = [], now = new Date().toISOString()) {
  const existingBySource = new Map()
  for (const item of existingItems) for (const source of item.sourceRefs ?? []) existingBySource.set(sourceKey(source), item)
  const groups = new Map()
  const groupForExisting = new Map()
  for (const item of existingItems) {
    const key = item.catalogItemId
    groups.set(key, { existing: item, records: asSourceRecord(item), touched: false })
    for (const source of item.sourceRefs ?? []) groupForExisting.set(sourceKey(source), key)
  }

  for (const incoming of incomingRecords) {
    const identity = sourceKey(incoming.sourceRefs[0])
    let groupKey = groupForExisting.get(identity)
    if (!groupKey) {
      groupKey = [...groups].find(([, group]) => group.records.some((record) => semanticMergeCompatible(record, incoming)))?.[0]
    }
    if (!groupKey) groupKey = `new:${identity}`
    const group = groups.get(groupKey) ?? { existing: null, records: [], touched: false }
    group.records = group.records.filter((record) => sourceKey(record.sourceRefs[0]) !== identity)
    group.records.push(incoming)
    group.touched = true
    groups.set(groupKey, group)
    groupForExisting.set(identity, groupKey)
  }

  const items = []
  const changes = { new: 0, changed: 0, unchanged: 0, retained: 0 }
  for (const group of groups.values()) {
    const firstSeenAt = group.existing?.firstSeenAt ?? now
    const candidate = combineRecords(group.records, group.existing?.catalogItemId, { firstSeenAt, lastSeenAt: group.touched ? now : group.existing?.lastSeenAt })
    if (!group.existing) changes.new += 1
    else if (!group.touched) changes.retained += 1
    // Recompute the stored side with the current contract instead of trusting
    // a legacy digest. A digest algorithm upgrade alone is not a business
    // change; the returned candidate silently writes the new baseline.
    else if (candidate.businessDigest === businessDigest(group.existing)) changes.unchanged += 1
    else changes.changed += 1
    items.push(candidate)
  }
  items.sort((left, right) => left.catalogItemId.localeCompare(right.catalogItemId, 'en'))
  return { items, changes }
}

export function groupingInputItem(item) {
  const variantTerms = unique((item.title.match(/\b(?:renewal|re-?release|special colou?r|another colou?r|pearl|pastel|online crane|limited|exclusive|last one)\b/giu) ?? []).map(normalized))
  return {
    catalogItemId: item.catalogItemId,
    title: item.title,
    normalizedTitle: normalized(item.title),
    comparisonKey: `${compact(item.title)}|${compact(item.manufacturer)}`,
    manufacturer: item.manufacturer,
    category: item.category,
    scale: item.scale,
    release: item.release,
    variantTerms,
    images: item.images,
    sourceRefs: item.sourceRefs,
    sourceIdentities: item.sourceRefs.map(sourceKey),
  }
}
