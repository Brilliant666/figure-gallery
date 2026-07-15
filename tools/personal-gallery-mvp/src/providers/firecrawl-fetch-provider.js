import Firecrawl from '@mendable/firecrawl-js'

import {
  isAllowedHpoiPageUrl,
  isCharacterUrl,
  isProductUrl,
  normalizePageUrl,
  sanitizeUrlForRecord,
} from '../parsers/urls.js'
import { parseCharacterCandidates, resolveCharacterMatch } from '../parsers/character-parser.js'

const BLOCKING_STATUS_CODES = new Set([401, 403, 429])
const RETRYABLE_STATUS_CODES = new Set([408, 500, 502, 503, 504])
const BLOCK_PATTERNS = [
  ['captcha', /captcha|人机验证|验证码/i],
  ['robot_verification', /robot\s*(?:check|verification)|verify\s*(?:you are|that you are)\s*(?:a\s*)?human|机器人验证/i],
  ['access_denied', /access\s*denied|访问被拒绝|拒绝访问/i],
  ['login_required', /login\s*required|please\s*log\s*in|登录后(?:访问|查看)|请(?:先)?登录/i],
  ['robots_denied', /robots\.txt[^\n]{0,80}(?:disallow|denied|blocked|forbid)|crawl(?:ing)?[^\n]{0,80}(?:denied|blocked|forbid)/i],
]

export class ProviderBlockedError extends Error {
  constructor(message, { category, statusCode = null, requestRecord = null } = {}) {
    super(message)
    this.name = 'ProviderBlockedError'
    this.category = category
    this.statusCode = statusCode
    this.requestRecord = requestRecord
  }
}

export class ProviderRequestError extends Error {
  constructor(message, { category = 'request_failed', statusCode = null, requestRecord = null } = {}) {
    super(message)
    this.name = 'ProviderRequestError'
    this.category = category
    this.statusCode = statusCode
    this.requestRecord = requestRecord
  }
}

function statusFromError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status)
  return Number.isInteger(status) ? status : null
}

function statusFromDocument(document) {
  const status = Number(document?.metadata?.statusCode)
  return Number.isInteger(status) ? status : 200
}

function classifyContent(document) {
  const statusCode = statusFromDocument(document)
  if (BLOCKING_STATUS_CODES.has(statusCode)) return { category: `http_${statusCode}`, statusCode }
  const finalUrl = document?.metadata?.sourceURL || document?.metadata?.url || null
  const normalizedFinalUrl = finalUrl ? normalizePageUrl(finalUrl) : null
  if (finalUrl && (
    !normalizedFinalUrl
    || !isAllowedHpoiPageUrl(normalizedFinalUrl)
    || (!isCharacterUrl(normalizedFinalUrl) && !isProductUrl(normalizedFinalUrl))
  )) return { category: 'redirect_outside_allowlist', statusCode }
  const robots = String(document?.metadata?.robots || '')
  if (/^(?:none|noindex\s*,?\s*nofollow)$/i.test(robots.trim())) return { category: 'robots_denied', statusCode }
  const content = [document?.rawHtml, document?.metadata?.error, document?.warning].filter(Boolean).join('\n')
  for (const [category, pattern] of BLOCK_PATTERNS) {
    if (pattern.test(content)) return { category, statusCode }
  }
  if (/\/login(?:[/?#]|$)/i.test(finalUrl || '')) return { category: 'login_required', statusCode }
  return null
}

function safeErrorCategory(error, statusCode) {
  if (BLOCKING_STATUS_CODES.has(statusCode)) return `http_${statusCode}`
  const text = String(error?.message || '')
  for (const [category, pattern] of BLOCK_PATTERNS) {
    if (pattern.test(text)) return category
  }
  return statusCode ? `http_${statusCode}` : 'network_or_sdk_error'
}

function redactedMessage(error, apiKey) {
  let value = String(error?.message || 'Firecrawl request failed.')
  if (apiKey) value = value.replaceAll(apiKey, '[REDACTED]')
  return value
    .replace(/https?:\/\/[^\s"']+/gi, (candidate) => sanitizeUrlForRecord(candidate) || '[REDACTED_URL]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 300)
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('The collection request was stopped.', 'AbortError')
}

function abortable(promise, signal) {
  throwIfAborted(signal)
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      try {
        throwIfAborted(signal)
      } catch (error) {
        reject(error)
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export class FirecrawlFetchProvider {
  constructor({
    apiKey,
    apiUrl = 'https://api.firecrawl.dev',
    gate = { allowed: false, missing: ['live gate not supplied'] },
    maxRetries = 2,
    requestDelayMs = 1_500,
    client = null,
    clientFactory = (options) => new Firecrawl(options),
    logger = () => {},
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) throw new Error('maxRetries must be from 0 through 2.')
    if (!Number.isInteger(requestDelayMs) || requestDelayMs < 1_500) throw new Error('requestDelayMs must be at least 1500.')
    this.apiKey = apiKey || null
    this.gate = gate
    this.maxRetries = maxRetries
    this.requestDelayMs = requestDelayMs
    this.logger = logger
    this.now = now
    this.sleep = sleep
    this.lastRequestStartedAt = null
    // The SDK interprets maxRetries as total attempts, so 1 means one request
    // and no transport retry. This provider owns the single bounded retry loop.
    this.client = client || clientFactory({ apiKey, apiUrl, maxRetries: 1 })
  }

  assertLiveGate() {
    if (this.gate?.allowed && this.apiKey) return
    const missing = [...(this.gate?.missing || [])]
    if (!this.apiKey && !missing.includes('FIRECRAWL_API_KEY')) missing.push('FIRECRAWL_API_KEY')
    throw new ProviderBlockedError(`Live fetch is disabled: ${missing.join(', ') || 'gate closed'}.`, {
      category: 'live_gate_closed',
    })
  }

  async waitForRequestSlot(signal) {
    if (this.lastRequestStartedAt !== null) {
      const remaining = this.requestDelayMs - (this.now() - this.lastRequestStartedAt)
      if (remaining > 0) await abortable(this.sleep(remaining), signal)
    }
    throwIfAborted(signal)
    this.lastRequestStartedAt = this.now()
  }

  async scrape(url, { requestType = 'scrape', includeProduct = false, signal } = {}) {
    this.assertLiveGate()
    const normalizedUrl = normalizePageUrl(url)
    if (!normalizedUrl || !isAllowedHpoiPageUrl(normalizedUrl) || (!isCharacterUrl(normalizedUrl) && !isProductUrl(normalizedUrl))) {
      throw new ProviderBlockedError('Target URL is outside the Hpoi character/product page allowlist.', { category: 'url_not_allowed' })
    }
    const formats = ['rawHtml', 'links', 'images']
    if (includeProduct) formats.push('product')
    return this.#request({
      target: normalizedUrl,
      requestType,
      estimatedCredits: 1,
      signal,
      operation: () => this.client.scrape(normalizedUrl, { formats }),
      normalize: (document) => ({
        rawHtml: document?.rawHtml || '',
        links: Array.isArray(document?.links) ? document.links : [],
        images: Array.isArray(document?.images) ? document.images : [],
        product: includeProduct ? document?.product || null : null,
        metadata: document?.metadata || {},
      }),
    })
  }

  async searchCharacters(query, { limit = 5, signal } = {}) {
    this.assertLiveGate()
    const normalizedQuery = String(query || '').trim()
    if (!normalizedQuery) throw new Error('Character query is required.')
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Search limit must be from 1 through 10.')
    return this.#request({
      target: 'firecrawl-search:hpoi-character',
      requestType: 'search',
      estimatedCredits: limit,
      signal,
      operation: () => this.client.search(`${normalizedQuery} site:hpoi.net/charactar/`, {
        sources: ['web'],
        includeDomains: ['hpoi.net'],
        limit,
      }),
      normalize: (data) => ({
        web: (data?.web || []).map((result) => {
          const normalizedUrl = normalizePageUrl(result?.url)
          return normalizedUrl && isCharacterUrl(normalizedUrl) ? { ...result, url: normalizedUrl } : null
        }).filter(Boolean),
        news: [],
        images: [],
      }),
      inspectContent: false,
    })
  }

  async discoverCharacter({ query, signal } = {}) {
    throwIfAborted(signal)
    const result = await this.searchCharacters(query, { signal })
    throwIfAborted(signal)
    const candidates = parseCharacterCandidates({
      query,
      searchResults: result.web,
    }).map((candidate) => ({
      title: candidate.title,
      work: candidate.workName,
      workName: candidate.workName,
      url: candidate.url,
      confidence: candidate.confidence,
      highConfidence: candidate.confidence === 'high',
    }))
    const resolution = resolveCharacterMatch(candidates)
    return {
      status: resolution.status,
      candidates,
      finalUrl: null,
      requestRecord: result.requestRecord,
    }
  }

  async fetchCharacterPage({ url, signal } = {}) {
    return this.#fetchPageAdapter({ url, signal, requestType: 'character', includeProduct: false })
  }

  async fetchProductPage({ url, signal } = {}) {
    return this.#fetchPageAdapter({ url, signal, requestType: 'product', includeProduct: true })
  }

  async #fetchPageAdapter({ url, signal, requestType, includeProduct }) {
    throwIfAborted(signal)
    const result = await this.scrape(url, { requestType, includeProduct, signal })
    throwIfAborted(signal)
    const status = Number(result.metadata?.statusCode ?? result.requestRecord?.statusCode ?? 200)
    return {
      rawHtml: result.rawHtml,
      links: result.links,
      images: result.images,
      product: result.product,
      firecrawlProduct: result.product,
      status,
      finalUrl: normalizePageUrl(result.metadata?.sourceURL || result.metadata?.url || result.requestRecord?.finalSourceUrl || url),
      requestRecord: result.requestRecord,
    }
  }

  async #request({ target, requestType, operation, normalize, inspectContent = true, estimatedCredits = 1, signal }) {
    const startedAtMs = this.now()
    let lastError = null
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForRequestSlot(signal)
      try {
        // The official SDK does not expose an AbortSignal for its Axios
        // transport. Do not race this promise: doing so would release the
        // single-run lock while the physical request was still in flight. A
        // stop therefore prevents all subsequent requests and waits for this
        // one bounded SDK call to settle before the run is finalized.
        const response = await operation()
        throwIfAborted(signal)
        const blocked = inspectContent ? classifyContent(response) : null
        const statusCode = inspectContent ? statusFromDocument(response) : 200
        if (blocked) {
          const record = this.#record({
            target,
            requestType,
            startedAtMs,
            statusCode: blocked.statusCode,
            finalSourceUrl: response?.metadata?.sourceURL || response?.metadata?.url || null,
            retries: attempt,
            credits: response?.metadata?.creditsUsed ?? null,
            estimatedCredits,
            success: false,
            failureCategory: blocked.category,
          })
          throw new ProviderBlockedError(`Source access stopped: ${blocked.category}.`, {
            category: blocked.category,
            statusCode: blocked.statusCode,
            requestRecord: record,
          })
        }
        if (statusCode >= 400) {
          const error = new Error(`Firecrawl returned HTTP ${statusCode}.`)
          error.status = statusCode
          throw error
        }
        const data = normalize(response)
        const record = this.#record({
          target,
          requestType,
          startedAtMs,
          statusCode,
          finalSourceUrl: response?.metadata?.sourceURL || response?.metadata?.url || (target.startsWith('https:') ? target : null),
          retries: attempt,
          credits: response?.metadata?.creditsUsed ?? null,
          estimatedCredits,
          success: true,
          failureCategory: null,
        })
        return { ...data, requestRecord: record }
      } catch (error) {
        if (error instanceof ProviderBlockedError) throw error
        if (signal?.aborted || error?.name === 'AbortError') {
          const record = this.#record({
            target,
            requestType,
            startedAtMs,
            statusCode: null,
            finalSourceUrl: null,
            retries: attempt,
            credits: null,
            estimatedCredits,
            success: false,
            failureCategory: 'user_abort',
          })
          error.requestRecord = record
          throw error
        }
        lastError = error
        const statusCode = statusFromError(error)
        const category = safeErrorCategory(error, statusCode)
        if (BLOCKING_STATUS_CODES.has(statusCode) || BLOCK_PATTERNS.some(([name]) => name === category)) {
          const record = this.#record({
            target,
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
          throw new ProviderBlockedError(`Source access stopped: ${category}.`, {
            category,
            statusCode,
            requestRecord: record,
          })
        }
        const canRetry = attempt < this.maxRetries && (statusCode === null || RETRYABLE_STATUS_CODES.has(statusCode))
        if (canRetry) continue
        const record = this.#record({
          target,
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
        throw new ProviderRequestError(redactedMessage(lastError, this.apiKey), {
          category,
          statusCode,
          requestRecord: record,
        })
      }
    }
    throw lastError
  }

  #record({ target, requestType, startedAtMs, statusCode, finalSourceUrl, retries, credits, estimatedCredits, success, failureCategory }) {
    const endedAtMs = this.now()
    const retryCount = Math.max(0, Number(retries) || 0)
    const hasReportedCredits = credits !== null && credits !== undefined
    const creditUsage = (hasReportedCredits ? Number(credits) || 0 : estimatedCredits) + retryCount * estimatedCredits
    const record = Object.freeze({
      url: sanitizeUrlForRecord(target),
      requestType,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      firecrawlSuccess: success,
      statusCode,
      finalSourceUrl: sanitizeUrlForRecord(finalSourceUrl),
      retries: retryCount,
      creditUsage,
      creditUsageKind: hasReportedCredits
        ? retryCount > 0 ? 'reported_plus_estimated_retries' : 'reported'
        : 'estimated_upper_bound',
      failureCategory,
    })
    this.logger(record)
    return record
  }
}

export const FIRECRAWL_ALLOWED_METHODS = Object.freeze(['scrape', 'search'])
