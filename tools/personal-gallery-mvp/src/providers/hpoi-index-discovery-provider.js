import Firecrawl from '@mendable/firecrawl-js'

import { buildHpoiIndexQueries, normalizeIndexedHpoiUrl } from '../discovery/hpoi-index.js'
import { validateCharacterConfig } from '../characters/registry.js'

const TERMINAL_STATUS_CODES = new Set([401, 403, 429])
const RETRYABLE_STATUS_CODES = new Set([408, 500, 502, 503, 504])
const TERMINAL_PATTERNS = [
  ['captcha', /captcha|hcaptcha|recaptcha|验证码|人机验证/iu],
  ['robot_verification', /robot\s*(?:check|verification)|verify\s*(?:you are|that you are)\s*(?:a\s*)?human|机器人验证/iu],
  ['access_denied', /access\s*denied|访问被拒绝|拒绝访问/iu],
  ['login_required', /login\s*required|please\s*log\s*in|请(?:先)?登录/iu],
  ['robots_denied', /robots\.txt[^\n]{0,80}(?:disallow|denied|blocked|forbid)/iu],
]

export const HPOI_INDEX_FIRECRAWL_METHODS = Object.freeze(['search'])

export class HpoiIndexDiscoveryError extends Error {
  constructor(message, { category = 'search_failed', statusCode = null, requestRecord = null, blocked = false } = {}) {
    super(message)
    this.name = blocked ? 'HpoiIndexDiscoveryBlockedError' : 'HpoiIndexDiscoveryError'
    this.category = category
    this.statusCode = statusCode
    this.requestRecord = requestRecord
    this.blocked = blocked
  }
}

function statusFromError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status)
  return Number.isInteger(status) ? status : null
}

function errorCategory(error, statusCode) {
  if (TERMINAL_STATUS_CODES.has(statusCode)) return `http_${statusCode}`
  const message = String(error?.message || '')
  return TERMINAL_PATTERNS.find(([, pattern]) => pattern.test(message))?.[0]
    || (statusCode ? `http_${statusCode}` : 'network_or_sdk_error')
}

function safeMessage(error, apiKey) {
  let message = String(error?.message || 'Firecrawl index search failed.')
  if (apiKey) message = message.replaceAll(apiKey, '[REDACTED]')
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/(?:api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .slice(0, 300)
}

function resultUrl(result) {
  return result?.url || result?.metadata?.sourceURL || result?.metadata?.url || null
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Hpoi index discovery stopped.', 'AbortError')
}

export class HpoiIndexDiscoveryProvider {
  constructor({
    apiKey,
    apiUrl = 'https://api.firecrawl.dev',
    gate = { allowed: false, missing: ['index discovery gate not supplied'] },
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
    this.client = client || clientFactory({ apiKey, apiUrl, maxRetries: 1 })
  }

  assertGate() {
    if (this.gate?.allowed && this.apiKey) return
    const missing = [...(this.gate?.missing || [])]
    if (!this.apiKey && !missing.includes('FIRECRAWL_API_KEY')) missing.push('FIRECRAWL_API_KEY')
    throw new HpoiIndexDiscoveryError(`Hpoi index discovery is disabled: ${missing.join(', ') || 'gate closed'}.`, {
      category: 'live_gate_closed',
      blocked: true,
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

  async searchIndexedHpoi(query, { limit = 10, signal } = {}) {
    this.assertGate()
    const discoveryQuery = String(query || '').trim()
    if (!/^site:hpoi\.net\s+/iu.test(discoveryQuery)) throw new Error('Hpoi index search query must be explicitly scoped with site:hpoi.net.')
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Search limit must be from 1 through 10.')
    const startedAtMs = this.now()
    let lastError
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForRequestSlot(signal)
      try {
        const value = await this.client.search(discoveryQuery, {
          sources: ['web'],
          includeDomains: ['hpoi.net'],
          limit,
        })
        throwIfAborted(signal)
        const requestRecord = this.#record({
          startedAtMs,
          retries: attempt,
          statusCode: 200,
          credits: value?.creditsUsed ?? value?.metadata?.creditsUsed,
          estimatedCredits: 2,
          success: true,
          failureCategory: null,
        })
        const results = (value?.web || []).map((result, index) => ({
          indexedUrl: normalizeIndexedHpoiUrl(resultUrl(result)),
          titleHint: String(result?.title || result?.metadata?.title || '').trim() || null,
          snippetHint: String(result?.description || result?.metadata?.description || '').trim() || null,
          query: discoveryQuery,
          rank: index + 1,
          searchProvider: 'firecrawl_search_v2',
          confidence: Math.max(0.5, 0.98 - index * 0.04),
        }))
        return { results, requestRecord }
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error
        lastError = error
        const statusCode = statusFromError(error)
        const category = errorCategory(error, statusCode)
        const terminal = TERMINAL_STATUS_CODES.has(statusCode) || TERMINAL_PATTERNS.some(([name]) => name === category)
        if (terminal || attempt >= this.maxRetries || (statusCode !== null && !RETRYABLE_STATUS_CODES.has(statusCode))) {
          const requestRecord = this.#record({
            startedAtMs,
            retries: attempt,
            statusCode,
            credits: null,
            estimatedCredits: 2,
            success: false,
            failureCategory: category,
          })
          throw new HpoiIndexDiscoveryError(safeMessage(lastError, this.apiKey), {
            category,
            statusCode,
            requestRecord,
            blocked: terminal,
          })
        }
      }
    }
    throw lastError
  }

  async discoverCharacter(characterConfig, {
    maxQueries = 30,
    maxResultsPerQuery = 10,
    maxRawResults = 200,
    signal,
    onRequest,
  } = {}) {
    const character = validateCharacterConfig(characterConfig)
    if (!Number.isInteger(maxRawResults) || maxRawResults < 1 || maxRawResults > 200) throw new Error('Raw Hpoi index result limit must be from 1 through 200.')
    const queries = buildHpoiIndexQueries(character, { maxQueries })
    const candidates = new Map()
    const querySummaries = []
    let rawResults = 0
    let duplicateResults = 0
    let rejectedResults = 0
    const snapshot = () => ({
      discoverySource: 'hpoi_search_index',
      characterId: character.characterId,
      queries,
      querySummaries: structuredClone(querySummaries),
      rawResults,
      duplicateResults,
      rejectedResults,
      candidates: structuredClone([...candidates.values()]),
      hpoiDirectHttpRequests: 0,
      hpoiDirectBrowserNavigations: 0,
      hpoiScrapeRequests: 0,
      hpoiApiRequests: 0,
    })
    for (const query of queries) {
      if (rawResults >= maxRawResults) break
      throwIfAborted(signal)
      let response
      try {
        response = await this.searchIndexedHpoi(query, { limit: maxResultsPerQuery, signal })
      } catch (error) {
        if (error?.requestRecord) onRequest?.(error.requestRecord)
        querySummaries.push({
          query,
          returned: 0,
          accepted: 0,
          rawResults,
          status: error?.blocked ? 'blocked' : 'failed',
          failureCategory: error?.category || error?.name || 'search_failed',
        })
        error.partialDiscovery = snapshot()
        throw error
      }
      onRequest?.(response.requestRecord)
      const returned = response.results.length
      let accepted = 0
      for (const result of response.results) {
        if (rawResults >= maxRawResults) break
        rawResults += 1
        if (!result.indexedUrl) {
          rejectedResults += 1
          continue
        }
        const current = candidates.get(result.indexedUrl)
        if (current) {
          duplicateResults += 1
          current.discoveryEvidence.push({ query: result.query, rank: result.rank })
          if ((result.rank || Number.MAX_SAFE_INTEGER) < (current.rank || Number.MAX_SAFE_INTEGER)) {
            Object.assign(current, { ...result, discoveryEvidence: current.discoveryEvidence })
          }
          continue
        }
        candidates.set(result.indexedUrl, {
          ...result,
          discoverySource: 'hpoi_search_index',
          discoveryEvidence: [{ query: result.query, rank: result.rank }],
        })
        accepted += 1
      }
      querySummaries.push({ query, returned, accepted, rawResults })
    }
    return snapshot()
  }

  #record({ startedAtMs, retries, statusCode, credits, estimatedCredits, success, failureCategory }) {
    const endedAtMs = this.now()
    const retryCount = Math.max(0, Number(retries) || 0)
    const hasReportedCredits = credits !== null && credits !== undefined
    const record = Object.freeze({
      url: null,
      requestType: 'hpoi_index_search',
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      firecrawlSuccess: success,
      statusCode,
      finalSourceUrl: null,
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
