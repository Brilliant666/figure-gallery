import { assertNoHpoiURL } from '@/security/networkGuard'

const trackingKeys = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'referrer',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
])

export const canonicalizeSourceURL = (raw: string): string => {
  const parsed = assertNoHpoiURL(raw, 'Source URL')
  parsed.hash = ''
  parsed.hostname = parsed.hostname.toLowerCase()

  for (const key of [...parsed.searchParams.keys()]) {
    if (trackingKeys.has(key.toLowerCase())) parsed.searchParams.delete(key)
  }

  const entries = [...parsed.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
  )
  parsed.search = ''
  for (const [key, value] of entries) parsed.searchParams.append(key, value)

  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString()
}

export const makeSourceKey = (input: {
  sourceItemId?: null | string
  sourceType: string
  sourceUrl: string
}): string => {
  const type = input.sourceType.trim().toLowerCase()
  if (!type) throw new Error('sourceType is required.')
  const sourceItemId = input.sourceItemId?.trim()
  return sourceItemId
    ? `${type}:id:${sourceItemId}`
    : `${type}:url:${canonicalizeSourceURL(input.sourceUrl)}`
}
