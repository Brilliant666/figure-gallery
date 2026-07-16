import { createHash } from 'node:crypto'

const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
])

const VOLATILE_PRODUCT_FIELDS = new Set([
  'collectedAt',
  'fetchMetadata',
  'fetchedAt',
  'observedAt',
  'parsedAt',
  'requestRecord',
  'requestRecords',
  'retrievedAt',
])

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeCanonicalUrl(input) {
  const url = new URL(input)
  url.hash = ''
  url.hostname = url.hostname.toLowerCase()
  url.protocol = url.protocol.toLowerCase()
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = ''
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
      url.searchParams.delete(key)
    }
  }
  url.searchParams.sort()
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
  return url.toString()
}

export function productIdentity(product) {
  const sourceType = product.sourceType || 'hpoi'
  const sourceItemId = product.sourceItemId ?? product.hpoiProductId ?? product.id ?? null
  if (sourceItemId !== null && String(sourceItemId).trim() !== '') {
    const normalizedId = String(sourceItemId).trim()
    return {
      key: `${sourceType}-id-${normalizedId.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
      kind: 'source_id',
      sourceItemId: normalizedId,
      sourceType,
    }
  }

  const rawUrl = product.sourceUrl ?? product.url
  if (!rawUrl) throw new Error('A product requires a stable source item ID or source URL.')
  const normalizedUrl = normalizeCanonicalUrl(rawUrl)
  return {
    key: `${sourceType}-url-${sha256(normalizedUrl)}`,
    kind: 'normalized_url',
    normalizedUrl,
    sourceItemId: null,
    sourceType,
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

export function stableJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function fieldDigest(fields) {
  return sha256(stableJson(fields))
}

export function businessFields(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).filter(([key]) => !VOLATILE_PRODUCT_FIELDS.has(key)),
  )
}

export function changedFields(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  return [...keys]
    .filter((key) => stableJson(before?.[key]) !== stableJson(after?.[key]))
    .sort()
}
