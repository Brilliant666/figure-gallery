import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

export const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPOSITORY_ROOT = path.resolve(TOOL_ROOT, '..', '..')
export const DEFAULT_RUNTIME_ROOT = path.join(REPOSITORY_ROOT, '.local', 'personal-gallery')
export const DEFAULT_CHESHIRE_OFFICIAL_SEED_URLS = Object.freeze([
  'https://www.goodsmile.com/en/product/36232/Cheshire%2BSummery%2BDate%2B',
  'https://www.goodsmile.com/en/product/36234/Cheshire%2BCait%2BSith%2BCrooner',
  'https://www.amiami.jp/top/detail/detail?gcode=FIGURE-188750',
  'https://www.amiami.jp/top/detail/detail?gcode=FIGURE-181336',
  'https://www.amiami.jp/top/detail/detail?gcode=FIGURE-158150',
])

function isSameOrInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

/**
 * Keep the disposable runtime away from source, while allowing the documented
 * repository-local `.local/personal-gallery` subtree or an external directory.
 * A target that contains the repository is especially dangerous because the
 * cleanup command recursively removes the target.
 */
export function validateRuntimeRoot(value) {
  const target = path.resolve(value)
  const filesystemRoot = path.parse(target).root
  if (target === filesystemRoot || isSameOrInside(target, REPOSITORY_ROOT)) {
    throw new Error(`Unsafe PERSONAL_GALLERY_ROOT: ${target}`)
  }
  if (isSameOrInside(REPOSITORY_ROOT, target) && !isSameOrInside(DEFAULT_RUNTIME_ROOT, target)) {
    throw new Error(
      `PERSONAL_GALLERY_ROOT inside the repository must stay under ${DEFAULT_RUNTIME_ROOT}.`,
    )
  }
  return target
}

export function loadLocalEnvironment() {
  const envPath = path.join(TOOL_ROOT, '.env')
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath)
  }
}

function integer(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name]
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} through ${max}.`)
  }
  return value
}

function boolean(name, fallback = false) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} must be true or false.`)
}

export function validateFirecrawlBaseUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('FIRECRAWL_BASE_URL must be exactly https://api.firecrawl.dev.')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'api.firecrawl.dev' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('FIRECRAWL_BASE_URL must be exactly https://api.firecrawl.dev.')
  }
  return 'https://api.firecrawl.dev'
}

export function loadConfig({ loadEnv = true } = {}) {
  if (loadEnv) loadLocalEnvironment()
  const host = process.env.PERSONAL_GALLERY_HOST || '127.0.0.1'
  if (host !== '127.0.0.1') {
    throw new Error('PERSONAL_GALLERY_HOST must be exactly 127.0.0.1.')
  }

  const rootValue = process.env.PERSONAL_GALLERY_ROOT?.trim()
  return Object.freeze({
    defaultQuery: process.env.PERSONAL_GALLERY_DEFAULT_QUERY || '柴郡',
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY?.trim() || null,
    firecrawlBaseUrl: validateFirecrawlBaseUrl(
      process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
    ),
    host,
    imageMaxBytes: integer('IMAGE_MAX_BYTES', 20_971_520, { min: 1, max: 50_000_000 }),
    liveFetchEnabled: boolean('HPOI_LIVE_FETCH_ENABLED'),
    maxImagesPerProduct: integer('HPOI_MAX_IMAGES_PER_PRODUCT', 5, { min: 1, max: 20 }),
    maxListPages: integer('HPOI_MAX_LIST_PAGES', 20, { min: 1, max: 50 }),
    maxProducts: integer('HPOI_MAX_PRODUCTS', 200, { min: 1, max: 500 }),
    maxRetries: integer('HPOI_MAX_RETRIES', 2, { min: 0, max: 2 }),
    port: integer('PERSONAL_GALLERY_PORT', 4317, { min: 1024, max: 65_535 }),
    requestConcurrency: integer('HPOI_REQUEST_CONCURRENCY', 1, { min: 1, max: 1 }),
    requestDelayMs: integer('HPOI_REQUEST_DELAY_MS', 1_500, { min: 1_500, max: 60_000 }),
    root: validateRuntimeRoot(rootValue || DEFAULT_RUNTIME_ROOT),
    writtenPermissionConfirmed: boolean('HPOI_WRITTEN_PERMISSION_CONFIRMED'),
    officialLiveFetchEnabled: boolean('OFFICIAL_SOURCE_LIVE_FETCH_ENABLED'),
    officialMaxSearchResultsPerQuery: integer('OFFICIAL_MAX_SEARCH_RESULTS_PER_QUERY', 10, { min: 1, max: 10 }),
    officialMaxCandidates: integer('OFFICIAL_MAX_CANDIDATES', 20, { min: 2, max: 20 }),
    officialMaxProducts: integer('OFFICIAL_MAX_PRODUCTS', 20, { min: 2, max: 20 }),
    officialMaxImagesPerProduct: integer('OFFICIAL_MAX_IMAGES_PER_PRODUCT', 10, { min: 1, max: 10 }),
    officialRequestDelayMs: integer('OFFICIAL_REQUEST_DELAY_MS', 1_000, { min: 1_000, max: 60_000 }),
    officialMaxRetries: integer('OFFICIAL_MAX_RETRIES', 2, { min: 0, max: 2 }),
    officialSeedUrls: DEFAULT_CHESHIRE_OFFICIAL_SEED_URLS,
  })
}

export function liveGate(config, { interactiveConfirmation = false } = {}) {
  const missing = ['Hpoi live source is permanently disabled after repeated captcha blocks']
  return {
    allowed: false,
    missing,
    notice:
      'Hpoi live access is disabled. Historical parsers remain available only for offline regression tests.',
  }
}

export function officialLiveGate(config, { interactiveConfirmation = false } = {}) {
  const missing = []
  if (!config.officialLiveFetchEnabled) missing.push('OFFICIAL_SOURCE_LIVE_FETCH_ENABLED=true')
  if (!interactiveConfirmation) missing.push('interactive official-source confirmation')
  if (!config.firecrawlApiKey) missing.push('FIRECRAWL_API_KEY')
  return {
    allowed: missing.length === 0,
    missing,
    notice:
      'Only reviewed public official manufacturer pages and explicit seed-only authorized official distributor pages may be scraped. Hpoi, user content, login, crawl, browser actions, and access-control bypass remain disabled.',
  }
}
