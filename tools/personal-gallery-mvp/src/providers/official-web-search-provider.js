import Firecrawl from '@mendable/firecrawl-js'
import { buildCharacterDiscoveryQueries, validateCharacterConfig } from '../characters/registry.js'

import {
  classifyOfficialSearchResult,
  isAllowedOfficialProductUrl,
  normalizeOfficialPageUrl,
  officialUrlIdentity,
} from '../parsers/official-urls.js'

const BLOCKING_STATUS_CODES = new Set([401, 403, 429])
const RETRYABLE_STATUS_CODES = new Set([408, 500, 502, 503, 504])
const BLOCK_PATTERNS = [
  ['captcha', /captcha|hcaptcha|recaptcha|人机验证|验证码/iu],
  ['robot_verification', /robot\s*(?:check|verification)|verify\s*(?:you are|that you are)\s*(?:a\s*)?human|机器人验证/iu],
  ['access_denied', /access\s*denied|访问被拒绝|拒绝访问/iu],
  ['login_required', /login\s*required|please\s*log\s*in|登录后(?:访问|查看)|请(?:先)?登录/iu],
  ['robots_denied', /robots\.txt[^\n]{0,80}(?:disallow|denied|blocked|forbid)|crawl(?:ing)?[^\n]{0,80}(?:denied|blocked|forbid)/iu],
]

export const OFFICIAL_FIRECRAWL_METHODS = Object.freeze(['search', 'scrape'])

export class OfficialProviderBlockedError extends Error {
  constructor(message, { category = 'source_refused', statusCode = null, requestRecord = null } = {}) {
    super(message)
    this.name = 'ProviderBlockedError'
    this.category = category
    this.statusCode = statusCode
    this.requestRecord = requestRecord
    this.blocked = true
  }
}

export class OfficialProviderRequestError extends Error {
  constructor(message, { category = 'request_failed', statusCode = null, requestRecord = null } = {}) {
    super(message)
    this.name = 'ProviderRequestError'
    this.category = category
    this.statusCode = statusCode
    this.requestRecord = requestRecord
  }
}

export function buildOfficialDiscoveryQueries(characterConfig, { maxQueries = 30 } = {}) {
  return buildCharacterDiscoveryQueries(validateCharacterConfig(characterConfig), { maxQueries })
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Official discovery stopped.', 'AbortError')
}

function statusFromError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status)
  return Number.isInteger(status) ? status : null
}

function safeCategory(error, statusCode) {
  if (BLOCKING_STATUS_CODES.has(statusCode)) return `http_${statusCode}`
  const value = String(error?.message || '')
  for (const [category, pattern] of BLOCK_PATTERNS) if (pattern.test(value)) return category
  return statusCode ? `http_${statusCode}` : 'network_or_sdk_error'
}

function redactedMessage(error, apiKey) {
  let message = String(error?.message || 'Firecrawl request failed.')
  if (apiKey) message = message.replaceAll(apiKey, '[REDACTED]')
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/(?:api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .slice(0, 300)
}

function documentBlock(document) {
  const statusCode = Number(document?.metadata?.statusCode ?? 200)
  if (BLOCKING_STATUS_CODES.has(statusCode)) return { category: `http_${statusCode}`, statusCode }
  const robots = String(document?.metadata?.robots || '')
  if (/^(?:none|noindex\s*,?\s*nofollow)$/iu.test(robots.trim())) return { category: 'robots_denied', statusCode }
  const rawHtml = [document?.rawHtml, document?.html].filter(Boolean).join('\n')
  const activeContent = rawHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, ' ')
  const title = String(document?.metadata?.title || /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(activeContent)?.[1] || '')
  const finalUrl = document?.metadata?.sourceURL || document?.metadata?.url || ''
  const finalPath = (() => {
    try { return new URL(finalUrl).pathname }
    catch { return '' }
  })()
  const productEvidence = /<(?:h1|main)\b|itemprop\s*=\s*["'](?:name|sku|offers)["']|(?:class|id)\s*=\s*["'][^"']*product/iu.test(activeContent)
  const content = [activeContent, document?.metadata?.error, document?.warning].filter(Boolean).join('\n')
  for (const [category, pattern] of BLOCK_PATTERNS) {
    if (!pattern.test(content)) continue
    if (category === 'login_required') {
      const explicitLoginPage =
        /\/(?:account\/)?(?:login|log-in|signin|sign-in)(?:\/|$)/iu.test(finalPath) ||
        /(?:login|required|sign\s*in|ログイン|登录|登入)/iu.test(title)
      if (!explicitLoginPage && productEvidence) continue
    }
    return { category, statusCode }
  }
  return null
}

function resultUrl(result) {
  return result?.url || result?.metadata?.sourceURL || result?.metadata?.url || null
}

export class OfficialWebSearchProvider {
  constructor({
    apiKey,
    apiUrl = 'https://api.firecrawl.dev',
    gate = { allowed: false, missing: ['official live gate not supplied'] },
    maxRetries = 2,
    requestDelayMs = 1_000,
    client = null,
    clientFactory = (options) => new Firecrawl(options),
    logger = () => {},
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) throw new Error('maxRetries must be from 0 through 2.')
    if (!Number.isInteger(requestDelayMs) || requestDelayMs < 1_000) throw new Error('requestDelayMs must be at least 1000.')
    this.apiKey = apiKey || null
    this.gate = gate
    this.maxRetries = maxRetries
    this.requestDelayMs = requestDelayMs
    this.logger = logger
    this.now = now
    this.sleep = sleep
    this.lastRequestStartedAt = null
    // The provider owns the only retry loop so every physical attempt is
    // delayed, counted, and visible in the persisted request record.
    // Firecrawl 4.30.0 names this setting `maxRetries`, but its transport
    // loop interprets the value as the total attempt count. A value of 1 is
    // therefore exactly one HTTP attempt and leaves all retry policy here.
    this.client = client || clientFactory({ apiKey, apiUrl, maxRetries: 1 })
  }

  assertLiveGate() {
    if (this.gate?.allowed && this.apiKey) return
    const missing = [...(this.gate?.missing || [])]
    if (!this.apiKey && !missing.includes('FIRECRAWL_API_KEY')) missing.push('FIRECRAWL_API_KEY')
    throw new OfficialProviderBlockedError(`Official live fetch is disabled: ${missing.join(', ') || 'gate closed'}.`, {
      category: 'live_gate_closed',
    })
  }

  async waitForRequestSlot(signal) {
    if (this.lastRequestStartedAt !== null) {
      const remaining = this.requestDelayMs - (this.now() - this.lastRequestStartedAt)
      if (remaining > 0) await this.sleep(remaining)
    }
    throwIfAborted(signal)
    this.lastRequestStartedAt = this.now()
  }

  async searchOfficialProducts(query, { limit = 10, signal } = {}) {
    this.assertLiveGate()
    const discoveryQuery = String(query || '').trim()
    if (!discoveryQuery) throw new Error('Official search query is required.')
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Search limit must be from 1 through 10.')
    const response = await this.#request({
      requestType: 'official_search',
      estimatedCredits: 2,
      signal,
      operation: () => this.client.search(discoveryQuery, {
        sources: ['web'],
        excludeDomains: ['hpoi.net', 'www.hpoi.net'],
        limit,
      }),
      inspectDocument: false,
    })
    const candidates = []
    const unreviewedDomains = []
    const rejected = []
    const seen = new Set()
    for (const result of response.value?.web || []) {
      const classification = classifyOfficialSearchResult(resultUrl(result))
      const entry = {
        title: String(result?.title || result?.metadata?.title || '').trim() || null,
        description: String(result?.description || result?.metadata?.description || '').trim() || null,
        discoveryQuery,
        discoveryMethod: 'firecrawl_search',
        sourceDomain: classification.sourceDomain,
        sourceUrl: classification.url,
        url: classification.url,
      }
      if (classification.status === 'allowed') {
        const identity = officialUrlIdentity(classification.url)
        if (identity && !seen.has(identity)) {
          seen.add(identity)
          candidates.push(entry)
        }
      } else if (classification.status === 'unreviewed_domain') {
        unreviewedDomains.push({ ...entry, status: classification.status })
      } else {
        rejected.push({ ...entry, status: classification.status })
      }
    }
    return { candidates, unreviewedDomains, rejected, requestRecord: response.requestRecord }
  }

  async fetchOfficialProductPage({ url, signal } = {}) {
    this.assertLiveGate()
    const normalizedUrl = normalizeOfficialPageUrl(url)
    if (!normalizedUrl || !isAllowedOfficialProductUrl(normalizedUrl)) {
      throw new OfficialProviderBlockedError('Target URL is outside the official product-page allowlist.', {
        category: 'url_not_allowed',
      })
    }
    const response = await this.#request({
      requestType: 'official_product',
      estimatedCredits: 1,
      signal,
      operation: () => this.client.scrape(normalizedUrl, { formats: ['html', 'rawHtml', 'links', 'images', 'product'] }),
      inspectDocument: true,
      expectedUrl: normalizedUrl,
    })
    const document = response.value || {}
    const finalUrl = normalizeOfficialPageUrl(document?.metadata?.sourceURL || document?.metadata?.url || normalizedUrl)
    if (!finalUrl || !isAllowedOfficialProductUrl(finalUrl)) {
      throw new OfficialProviderBlockedError('Official page redirected outside the product-page allowlist.', {
        category: 'redirect_outside_allowlist',
        statusCode: Number(document?.metadata?.statusCode ?? 200),
        requestRecord: response.requestRecord,
      })
    }
    return {
      rawHtml: document.rawHtml || '',
      renderedHtml: document.html || '',
      links: Array.isArray(document.links) ? document.links : [],
      images: Array.isArray(document.images) ? document.images : [],
      product: document.product || null,
      firecrawlProduct: document.product || null,
      status: Number(document?.metadata?.statusCode ?? 200),
      finalUrl,
      requestRecord: response.requestRecord,
    }
  }

  async #request({ requestType, operation, estimatedCredits, signal, inspectDocument, expectedUrl = null }) {
    const startedAtMs = this.now()
    let lastError
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForRequestSlot(signal)
      try {
        const value = await operation()
        throwIfAborted(signal)
        let blocked = inspectDocument ? documentBlock(value) : null
        const reportedFinalUrl = inspectDocument
          ? value?.metadata?.sourceURL || value?.metadata?.url || expectedUrl
          : null
        if (inspectDocument && !blocked) {
          const normalizedFinalUrl = normalizeOfficialPageUrl(reportedFinalUrl)
          if (!normalizedFinalUrl || !isAllowedOfficialProductUrl(normalizedFinalUrl)) {
            blocked = {
              category: 'redirect_outside_allowlist',
              statusCode: Number(value?.metadata?.statusCode ?? 200),
            }
          }
        }
        if (blocked) {
          const requestRecord = this.#record({
            requestType,
            startedAtMs,
            statusCode: blocked.statusCode,
            finalSourceUrl: reportedFinalUrl,
            retries: attempt,
            credits: value?.creditsUsed ?? value?.metadata?.creditsUsed,
            estimatedCredits,
            success: false,
            failureCategory: blocked.category,
          })
          throw new OfficialProviderBlockedError(`Source access stopped: ${blocked.category}.`, {
            category: blocked.category,
            statusCode: blocked.statusCode,
            requestRecord,
          })
        }
        const statusCode = inspectDocument ? Number(value?.metadata?.statusCode ?? 200) : 200
        if (statusCode >= 400) throw Object.assign(new Error(`Firecrawl returned HTTP ${statusCode}.`), { status: statusCode })
        const requestRecord = this.#record({
          requestType,
          startedAtMs,
          statusCode,
          finalSourceUrl: reportedFinalUrl,
          retries: attempt,
          credits: value?.creditsUsed ?? value?.metadata?.creditsUsed,
          estimatedCredits,
          success: true,
          failureCategory: null,
        })
        return { value, requestRecord }
      } catch (error) {
        if (error instanceof OfficialProviderBlockedError) throw error
        if (signal?.aborted || error?.name === 'AbortError') throw error
        lastError = error
        const statusCode = statusFromError(error)
        const category = safeCategory(error, statusCode)
        if (BLOCKING_STATUS_CODES.has(statusCode) || BLOCK_PATTERNS.some(([name]) => name === category)) {
          const requestRecord = this.#record({
            requestType,
            startedAtMs,
            statusCode,
            finalSourceUrl: null,
            retries: attempt,
            credits: null,
            estimatedCredits,
            success: false,
            failureCategory: category,
          })
          throw new OfficialProviderBlockedError(`Source access stopped: ${category}.`, {
            category,
            statusCode,
            requestRecord,
          })
        }
        if (attempt < this.maxRetries && (statusCode === null || RETRYABLE_STATUS_CODES.has(statusCode))) continue
        const requestRecord = this.#record({
          requestType,
          startedAtMs,
          statusCode,
          finalSourceUrl: null,
          retries: attempt,
          credits: null,
          estimatedCredits,
          success: false,
          failureCategory: category,
        })
        throw new OfficialProviderRequestError(redactedMessage(lastError, this.apiKey), {
          category,
          statusCode,
          requestRecord,
        })
      }
    }
    throw lastError
  }

  #record({ requestType, startedAtMs, statusCode, finalSourceUrl, retries, credits, estimatedCredits, success, failureCategory }) {
    const endedAtMs = this.now()
    const retryCount = Math.max(0, Number(retries) || 0)
    const hasReportedCredits = credits !== null && credits !== undefined
    const record = Object.freeze({
      url: null,
      requestType,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      firecrawlSuccess: success,
      statusCode,
      finalSourceUrl: finalSourceUrl ? normalizeOfficialPageUrl(finalSourceUrl) : null,
      retries: retryCount,
      creditUsage: (hasReportedCredits ? Number(credits) || 0 : estimatedCredits) + retryCount * estimatedCredits,
      creditUsageKind: hasReportedCredits
        ? retryCount > 0 ? 'reported_plus_estimated_retries' : 'reported'
        : 'estimated_upper_bound',
      failureCategory,
    })
    this.logger(record)
    return record
  }
}
