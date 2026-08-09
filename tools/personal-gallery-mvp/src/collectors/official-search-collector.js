import { setTimeout as delay } from 'node:timers/promises'

import { CollectionBlockedError, toCollectionError } from './access-policy.js'
import { parseOfficialProductPage, OfficialPageValidationError } from '../parsers/official-product-parser.js'
import {
  isAllowedOfficialProductUrl,
  normalizeOfficialPageUrl,
  officialUrlIdentity,
  sanitizeUnreviewedSearchResultUrl,
} from '../parsers/official-urls.js'
import { buildOfficialDiscoveryQueries } from '../providers/official-web-search-provider.js'
import { downloadAndStoreImage } from '../storage/image-store.js'
import { validateCharacterConfig } from '../characters/registry.js'

function assertNotAborted(signal) {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Official collection stopped.', 'AbortError')
}

function bounded(value, fallback, max) {
  const number = Number(value ?? fallback)
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`Limit must be from 1 through ${max}.`)
  return number
}

function classificationCounter(value) {
  return ({
    likely_scale: 'likelyScale',
    likely_prize: 'likelyPrize',
    likely_static: 'likelyStatic',
    other: 'other',
    unknown: 'unknown',
  })[value] || 'unknown'
}

function imageUrls(product) {
  const values = [
    product?.homepageImage,
    ...(product?.candidateImages || []).map((image) => typeof image === 'string' ? image : image?.url),
    ...(product?.imageUrls || []),
  ].filter(Boolean)
  return [...new Set(values)]
}

function failureRecord(kind, url, error, context = {}) {
  return {
    kind,
    url: url || null,
    code: error?.code || error?.category || error?.name || 'unknown_error',
    status: error?.status ?? error?.statusCode ?? null,
    blocked: Boolean(error?.blocked || error instanceof CollectionBlockedError),
    message: error?.message || String(error),
    ...context,
  }
}

export class OfficialSearchCollector {
  constructor({
    provider,
    store,
    parser = parseOfficialProductPage,
    downloadImage = downloadAndStoreImage,
    fetchImpl = null,
    dnsLookup,
    config = {},
    sleep = (milliseconds, signal) => delay(milliseconds, undefined, { signal }),
    progress,
  } = {}) {
    if (!provider || typeof provider.searchOfficialProducts !== 'function' || typeof provider.fetchOfficialProductPage !== 'function') {
      throw new Error('OfficialSearchCollector requires an OfficialWebSearchProvider-compatible provider.')
    }
    if (!store || typeof store.createRun !== 'function' || typeof store.upsertProduct !== 'function') {
      throw new Error('OfficialSearchCollector requires GalleryStore-compatible storage.')
    }
    if (typeof parser !== 'function') throw new Error('OfficialSearchCollector requires an official product parser.')
    this.provider = provider
    this.store = store
    this.parser = parser
    this.downloadImage = downloadImage
    this.fetchImpl = fetchImpl
    this.dnsLookup = dnsLookup
    this.config = config
    this.sleep = sleep
    this.progress = progress
    this.recordedRequests = new Set()
    this.lastImageRequestAt = 0
  }

  async collect({ query, characterConfig, seedUrls = [], limits = {}, requestedRunId = null, signal } = {}) {
    const character = validateCharacterConfig(characterConfig)
    const effectiveQuery = String(query || character.displayName).trim()
    const discoveryQueries = buildOfficialDiscoveryQueries(character, {
      maxQueries: bounded(limits.maxQueries, this.config.officialMaxQueries || 30, 30),
    })
    const effective = {
      searchLimit: bounded(limits.searchLimit, this.config.officialMaxSearchResultsPerQuery || 10, 10),
      maxCandidates: bounded(limits.maxCandidates, this.config.officialMaxCandidates || 80, 80),
      maxProducts: bounded(limits.maxProducts, this.config.officialMaxProducts || 80, 80),
      maxImagesPerProduct: bounded(limits.maxImagesPerProduct, this.config.officialMaxImagesPerProduct || 10, 10),
      requestDelayMs: bounded(limits.requestDelayMs, this.config.officialRequestDelayMs || 1_000, 60_000),
      imageRequestDelayMs: bounded(
        limits.imageRequestDelayMs,
        this.config.officialImageRequestDelayMs || 1_000,
        60_000,
      ),
      imageMaxBytes: bounded(limits.imageMaxBytes, this.config.imageMaxBytes || 20_971_520, 50_000_000),
      requestConcurrency: 1,
    }
    if (effective.requestDelayMs < 1_000) throw new Error('Official request delay must be at least 1000 ms.')
    const run = await this.store.createRun({
      query: effectiveQuery,
      characterId: character.characterId,
      characterSlug: character.slug,
      characterDisplayName: character.displayName,
      characterConfig: character,
      discoveryQueries,
      limits: effective,
      requestedRunId,
      sourceMode: 'official_sources',
    })
    const counters = {
      ...run.counters,
      searchRequests: 0,
      scrapeRequests: 0,
      officialCandidates: 0,
      unreviewedDomains: 0,
      productsDiscovered: 0,
      productsProcessed: 0,
      productsNew: 0,
      productsUnchanged: 0,
      productsChanged: 0,
      productFailures: 0,
      imageUrls: 0,
      imagesDownloaded: 0,
      imageFailures: 0,
      uniqueObjects: 0,
      duplicateImages: 0,
      likelyScale: 0,
      likelyPrize: 0,
      likelyStatic: 0,
      unknown: 0,
      other: 0,
    }
    const candidates = new Map()
    const unreviewedDomains = []
    let status = 'completed'
    let stopReason = null

    try {
      for (const discoveryQuery of discoveryQueries) {
        assertNotAborted(signal)
        try {
          const result = await this.provider.searchOfficialProducts(discoveryQuery, {
            limit: effective.searchLimit,
            signal,
          })
          counters.searchRequests += 1 + Math.max(0, Number(result?.requestRecord?.retries) || 0)
          await this.#recordRequest(run.runId, result?.requestRecord)
          for (const entry of result?.unreviewedDomains || []) {
            const safeUrl = sanitizeUnreviewedSearchResultUrl(entry?.url || entry?.sourceUrl)
            const safeEntry = {
              ...entry,
              url: safeUrl,
              sourceUrl: safeUrl,
            }
            unreviewedDomains.push(safeEntry)
            counters.unreviewedDomains += 1
            await this.store.recordWarning?.(run.runId, {
              kind: 'unreviewed_domain',
              sourceDomain: safeEntry.sourceDomain,
              url: safeEntry.url,
              discoveryQuery,
            })
          }
          for (const candidate of result?.candidates || []) this.#addCandidate(candidates, candidate)
        } catch (caught) {
          await this.#recordRequest(run.runId, caught?.requestRecord)
          const error = toCollectionError(caught)
          if (error instanceof CollectionBlockedError || error?.name === 'AbortError') throw error
          await this.store.recordFailure?.(run.runId, failureRecord('search', null, error, { discoveryQuery }))
        }
      }

      for (const seed of [...(character.reviewedSeeds || []), ...(seedUrls || [])]) {
        const sourceUrl = normalizeOfficialPageUrl(typeof seed === 'string' ? seed : seed?.url)
        if (!sourceUrl || !isAllowedOfficialProductUrl(sourceUrl)) {
          await this.store.recordWarning?.(run.runId, { kind: 'seed_official_url_not_allowed', url: sourceUrl })
          continue
        }
        this.#addCandidate(candidates, {
          ...(typeof seed === 'object' ? seed : {}),
          url: sourceUrl,
          sourceUrl,
          sourceDomain: new URL(sourceUrl).hostname.toLowerCase(),
          discoveryQuery: null,
          discoveryMethod: 'seed_official_url',
        }, { searchWins: true })
      }

      const selected = [...candidates.values()].slice(0, effective.maxCandidates).slice(0, effective.maxProducts)
      counters.officialCandidates = candidates.size
      counters.productsDiscovered = selected.length
      if (candidates.size > selected.length) {
        status = 'partial_by_limit'
        stopReason = candidates.size > effective.maxCandidates ? 'max_candidates' : 'max_products'
      }
      await this.#checkpoint(run.runId, counters, { phase: 'discovery', candidates: selected.length })

      for (const candidate of selected) {
        assertNotAborted(signal)
        let page
        try {
          page = await this.provider.fetchOfficialProductPage({ url: candidate.url, signal })
          counters.scrapeRequests += 1 + Math.max(0, Number(page?.requestRecord?.retries) || 0)
          await this.#recordRequest(run.runId, page?.requestRecord)
        } catch (caught) {
          await this.#recordRequest(run.runId, caught?.requestRecord)
          const error = toCollectionError(caught, { url: candidate.url })
          if (error instanceof CollectionBlockedError || error?.name === 'AbortError') throw error
          counters.productFailures += 1
          await this.store.recordFailure?.(run.runId, failureRecord('product', candidate.url, error))
          continue
        }

        let product
        try {
          product = await this.parser({
            ...page,
            url: page.finalUrl || candidate.url,
            discoveryQuery: candidate.discoveryQuery,
            discoveryMethod: candidate.discoveryMethod,
            characterConfig: character,
          })
        } catch (error) {
          counters.productFailures += 1
          await this.store.recordFailure?.(run.runId, failureRecord(
            error instanceof OfficialPageValidationError ? 'official_page_validation' : 'product_parser',
            candidate.url,
            error,
          ))
          continue
        }

        if (product.classification === 'other') {
          counters.other += 1
          await this.store.recordWarning?.(run.runId, {
            kind: 'out_of_scope_product',
            productUrl: candidate.url,
            excludedReason: product.excludedReason || 'classification_other',
          })
          continue
        }

        const upsert = await this.store.upsertProduct(run.runId, product)
        counters.productsProcessed += 1
        const stateCounter = `products${upsert.state[0].toUpperCase()}${upsert.state.slice(1)}`
        counters[stateCounter] = (counters[stateCounter] || 0) + 1
        counters[classificationCounter(product.classification)] += 1
        for (const warning of product.parserWarnings || []) {
          await this.store.recordWarning?.(run.runId, { kind: 'parser', productUrl: candidate.url, warning })
        }

        const urls = imageUrls(product).slice(0, effective.maxImagesPerProduct)
        counters.imageUrls += urls.length
        const allowedImages = new Set(urls)
        for (const imageUrl of urls) {
          assertNotAborted(signal)
          try {
            await this.#waitForImageSlot(effective.imageRequestDelayMs, signal)
            const image = await this.downloadImage({
              url: imageUrl,
              sourceProductUrl: product.sourceUrl,
              productKey: upsert.productKey,
              store: this.store,
              fetchImpl: this.fetchImpl,
              allowImageUrl: (value, context = {}) => context.sourceProductUrl === product.sourceUrl && allowedImages.has(value),
              maxBytes: effective.imageMaxBytes,
              signal,
              dnsLookup: this.dnsLookup,
              runId: run.runId,
            })
            counters.imagesDownloaded += 1
            if (image.duplicate) counters.duplicateImages += 1
            else counters.uniqueObjects += 1
          } catch (caught) {
            const error = toCollectionError(caught, { url: imageUrl })
            counters.imageFailures += 1
            await this.store.recordFailure?.(run.runId, failureRecord('image', imageUrl, error, {
              productUrl: product.sourceUrl,
            }))
            if (error instanceof CollectionBlockedError || error?.name === 'AbortError') throw error
          }
        }
        await this.#checkpoint(run.runId, counters, {
          phase: 'product',
          currentUrl: product.sourceUrl,
          currentProductKey: upsert.productKey,
        })
      }
    } catch (caught) {
      const error = toCollectionError(caught)
      if (error?.name === 'AbortError' || signal?.aborted) {
        status = 'stopped'
        stopReason = 'user_stop'
      } else if (error instanceof CollectionBlockedError) {
        status = 'blocked'
        stopReason = error.code
        await this.store.recordFailure?.(run.runId, failureRecord('run', error.url, error))
      } else {
        status = 'failed'
        stopReason = error.code || 'unexpected_error'
        await this.store.recordFailure?.(run.runId, failureRecord('run', error.url, error))
      }
    }

    const finalized = await this.store.finalizeRun(run.runId, {
      status,
      stopReason,
      counters,
      extra: {
        sourceMode: 'official_sources',
        characterId: character.characterId,
        characterSlug: character.slug,
        characterDisplayName: character.displayName,
        discoveryQueries,
        unreviewedDomains,
      },
    })
    await this.store.writeCoverage?.(character.slug, {
      schemaVersion: 1,
      characterId: character.characterId,
      characterSlug: character.slug,
      runId: run.runId,
      status,
      searchQueries: discoveryQueries.length,
      searchCandidates: candidates.size,
      officialHits: counters.productsProcessed,
      unreviewedDomains: new Set(unreviewedDomains.map((entry) => entry.sourceDomain).filter(Boolean)).size,
      retailerOnlySeeds: character.reviewedSeeds.filter((seed) => seed.sourceType === 'retailer_seed_only').length,
      parserUnsupported: counters.productFailures,
      sourceBlocked: status === 'blocked' ? 1 : 0,
      outOfScopeProducts: counters.other,
      duplicateCandidates: Math.max(0, counters.officialCandidates - counters.productsDiscovered),
      hpoiRequests: 0,
    })
    return finalized
  }

  #addCandidate(target, candidate, { searchWins = false } = {}) {
    const url = normalizeOfficialPageUrl(candidate?.url || candidate?.sourceUrl)
    if (!url || !isAllowedOfficialProductUrl(url)) return false
    const key = officialUrlIdentity(url)
    if (!key) return false
    const current = target.get(key)
    if (current && (searchWins || current.discoveryMethod === 'firecrawl_search')) return false
    target.set(key, {
      ...candidate,
      url,
      sourceUrl: url,
      sourceDomain: new URL(url).hostname.toLowerCase(),
      discoveryMethod: candidate.discoveryMethod === 'seed_official_url' ? 'seed_official_url' : 'firecrawl_search',
    })
    return true
  }

  async #recordRequest(runId, record) {
    if (!record || typeof this.store.recordRequest !== 'function') return
    const fingerprint = [record.requestType, record.startedAt, record.endedAt, record.retries, record.firecrawlSuccess].join('|')
    if (this.recordedRequests.has(fingerprint)) return
    this.recordedRequests.add(fingerprint)
    await this.store.recordRequest(runId, record)
  }

  async #waitForImageSlot(milliseconds, signal) {
    const elapsed = Date.now() - this.lastImageRequestAt
    if (this.lastImageRequestAt && elapsed < milliseconds) await this.sleep(milliseconds - elapsed, signal)
    assertNotAborted(signal)
    this.lastImageRequestAt = Date.now()
  }

  async #checkpoint(runId, counters, detail) {
    if (typeof this.store.updateRun === 'function') {
      await this.store.updateRun(runId, (run) => ({ ...run, counters, progress: detail }))
    }
    if (typeof this.progress === 'function') await this.progress({ runId, counters: structuredClone(counters), ...detail })
  }
}

export async function collectOfficialGallery(options = {}) {
  const collector = new OfficialSearchCollector(options)
  return collector.collect(options)
}
