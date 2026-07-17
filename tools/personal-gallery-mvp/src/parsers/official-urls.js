const OFFICIAL_HOSTS = new Set([
  'goodsmile.com',
  'www.goodsmile.com',
  'goodsmilearts.com',
  'www.goodsmilearts.com',
  'alter-web.jp',
  'www.alter-web.jp',
])

const HPOI_DENIED_ROOT_HOSTS = new Set([
  'hpoi.net',
  'hpoi.net.cn',
])

const TRACKING_PARAMETER = /^(?:fbclid|gclid|mc_cid|mc_eid|ref|source|utm_.*)$/i
const SENSITIVE_PARAMETER = /^(?:access_?token|api_?key|apikey|auth|authorization|cookie|password|secret|session|session_?id|sid|token)$/i
const NON_PRODUCT_PATH = /\/(?:account|accounts|blog|cart|checkout|community|forum|login|log-in|member|news|search|sign-in|signin|user|users)(?:\/|$)/i

export const OFFICIAL_ALLOWED_PAGE_HOSTS = Object.freeze([...OFFICIAL_HOSTS])

export function parseOfficialHttpUrl(value, baseUrl) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = baseUrl ? new URL(value, baseUrl) : new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    if ([...parsed.searchParams.keys()].some((key) => SENSITIVE_PARAMETER.test(key))) return null
    return parsed
  } catch {
    return null
  }
}

export function isHpoiHost(value) {
  const hostname = String(value || '').replace(/\.$/, '').toLowerCase()
  return [...HPOI_DENIED_ROOT_HOSTS].some(
    (root) => hostname === root || hostname.endsWith(`.${root}`),
  )
}

export function sanitizeUnreviewedSearchResultUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
  parsed.hash = ''
  // Unreviewed domains are metadata only, so no query value is needed for
  // later access. Dropping the entire query also covers unknown signed URL or
  // credential parameter names that a finite sensitive-key list cannot know.
  parsed.search = ''
  return parsed.href
}

export function canonicalOfficialDomain(value) {
  const hostname = String(value || '').replace(/\.$/, '').toLowerCase()
  if (!OFFICIAL_HOSTS.has(hostname)) return null
  return hostname.replace(/^www\./, '')
}

export function isAllowedOfficialDomain(value) {
  return OFFICIAL_HOSTS.has(String(value || '').replace(/\.$/, '').toLowerCase())
}

export function normalizeOfficialPageUrl(value, baseUrl) {
  const parsed = parseOfficialHttpUrl(value, baseUrl)
  if (!parsed || !isAllowedOfficialDomain(parsed.hostname) || isHpoiHost(parsed.hostname)) return null
  parsed.hostname = parsed.hostname.toLowerCase()
  parsed.hash = ''
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMETER.test(key)) parsed.searchParams.delete(key)
  }
  parsed.searchParams.sort()
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/'
  return parsed.href
}

export function isAllowedOfficialProductUrl(value, baseUrl) {
  const normalized = normalizeOfficialPageUrl(value, baseUrl)
  if (!normalized) return false
  const parsed = new URL(normalized)
  return parsed.pathname !== '/' && !NON_PRODUCT_PATH.test(parsed.pathname)
}

export function officialUrlIdentity(value, baseUrl) {
  const normalized = normalizeOfficialPageUrl(value, baseUrl)
  if (!normalized) return null
  const parsed = new URL(normalized)
  const canonicalDomain = canonicalOfficialDomain(parsed.hostname)
  return `${canonicalDomain}${parsed.pathname}${parsed.search}`
}

export function classifyOfficialSearchResult(value) {
  let parsed
  try {
    parsed = new URL(typeof value === 'string' ? value : value?.url)
  } catch {
    return { status: 'invalid_url', sourceDomain: null, url: null }
  }
  const sourceDomain = parsed.hostname.replace(/\.$/, '').toLowerCase()
  if (isHpoiHost(sourceDomain)) {
    return { status: 'hpoi_denied', sourceDomain, url: null }
  }
  if (!isAllowedOfficialDomain(sourceDomain)) {
    return {
      status: 'unreviewed_domain',
      sourceDomain,
      url: sanitizeUnreviewedSearchResultUrl(parsed.href),
    }
  }
  const url = normalizeOfficialPageUrl(parsed.href)
  if (!url) return { status: 'invalid_url', sourceDomain, url: null }
  if (!isAllowedOfficialProductUrl(url)) return { status: 'non_product_path', sourceDomain, url }
  return { status: 'allowed', sourceDomain, url }
}
