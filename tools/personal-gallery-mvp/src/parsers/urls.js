import { createHash } from 'node:crypto'

const HPOI_PAGE_HOSTS = new Set(['hpoi.net', 'www.hpoi.net'])
const CHARACTER_PATH = /^\/charactar\/(\d+)(?:\/)?$/i
const PRODUCT_PATH = /^\/(?:move\/)?hobby\/(\d+)(?:\/)?$/i
const SENSITIVE_PAGE_QUERY_KEY = /^(?:access_?token|api_?key|apikey|auth|authorization|cookie|session|session_?id|sid|token)$/i

function hasSensitivePageQuery(parsed) {
  return [...parsed.searchParams.keys()].some((key) => SENSITIVE_PAGE_QUERY_KEY.test(key))
}

export function parseHttpUrl(value, baseUrl) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = baseUrl ? new URL(value, baseUrl) : new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    if (parsed.username || parsed.password) return null
    return parsed
  } catch {
    return null
  }
}

export function sanitizeUrlForRecord(value) {
  if (value === 'firecrawl-search:hpoi-character') return value
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    parsed.username = ''
    parsed.password = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_PAGE_QUERY_KEY.test(key)) parsed.searchParams.delete(key)
    }
    return parsed.href
  } catch {
    return null
  }
}

export function isAllowedHpoiPageUrl(value) {
  const parsed = parseHttpUrl(value)
  return Boolean(
    parsed
    && parsed.protocol === 'https:'
    && HPOI_PAGE_HOSTS.has(parsed.hostname.toLowerCase())
    && !hasSensitivePageQuery(parsed),
  )
}

export function normalizePageUrl(value, baseUrl) {
  const parsed = parseHttpUrl(value, baseUrl)
  if (!parsed || !HPOI_PAGE_HOSTS.has(parsed.hostname.toLowerCase()) || hasSensitivePageQuery(parsed)) return null
  parsed.protocol = 'https:'
  parsed.hostname = parsed.hostname.toLowerCase() === 'hpoi.net' ? 'www.hpoi.net' : parsed.hostname.toLowerCase()
  parsed.hash = ''
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(?:utm_|spm|from|source|ref)/i.test(key)) parsed.searchParams.delete(key)
  }
  parsed.searchParams.sort()
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.href
}

export function extractCharacterId(value, baseUrl) {
  const parsed = parseHttpUrl(value, baseUrl)
  if (!parsed || !HPOI_PAGE_HOSTS.has(parsed.hostname.toLowerCase()) || hasSensitivePageQuery(parsed)) return null
  return CHARACTER_PATH.exec(parsed.pathname)?.[1] ?? null
}

export function extractProductId(value, baseUrl) {
  const parsed = parseHttpUrl(value, baseUrl)
  if (!parsed || !HPOI_PAGE_HOSTS.has(parsed.hostname.toLowerCase()) || hasSensitivePageQuery(parsed)) return null
  return PRODUCT_PATH.exec(parsed.pathname)?.[1] ?? null
}

export function isCharacterUrl(value, baseUrl) {
  return extractCharacterId(value, baseUrl) !== null
}

export function isProductUrl(value, baseUrl) {
  return extractProductId(value, baseUrl) !== null
}

export function stableUrlHash(value) {
  const normalized = normalizePageUrl(value)
  if (!normalized) throw new Error('Cannot hash a non-Hpoi page URL.')
  return createHash('sha256').update(normalized).digest('hex')
}

export function isDirectImageUrl(value, baseUrl) {
  const parsed = parseHttpUrl(value, baseUrl)
  return Boolean(parsed && ['http:', 'https:'].includes(parsed.protocol) && !hasSensitivePageQuery(parsed))
}

export function normalizeImageUrl(value, baseUrl) {
  const parsed = parseHttpUrl(value, baseUrl)
  if (!parsed || hasSensitivePageQuery(parsed)) return null
  parsed.hash = ''
  return parsed.href
}

export const HPOI_ALLOWED_PAGE_HOSTS = Object.freeze([...HPOI_PAGE_HOSTS])
