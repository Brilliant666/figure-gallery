import { setTimeout as delay } from 'node:timers/promises'
import { CollectionBlockedError, detectBlockingResult, errorFingerprint, toCollectionError } from './access-policy.js'
import { downloadAndStoreImage } from '../storage/image-store.js'
import { isCharacterUrl, normalizePageUrl } from '../parsers/urls.js'

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function abortError() {
  return new DOMException('Collection was stopped.', 'AbortError')
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw signal.reason || abortError()
}

function defaultPageAllowlist(input) {
  try {
    const { hostname, protocol } = new URL(input)
    return (protocol === 'https:' || protocol === 'http:') && (hostname === 'hpoi.net' || hostname === 'www.hpoi.net')
  } catch {
    return false
  }
}

function pageProducts(parsed) {
  return unique(parsed?.productUrls || parsed?.detailUrls || parsed?.products?.map((item) => item.url || item.sourceUrl) || [])
}

function nextPage(parsed) {
  return parsed?.nextPageUrl || parsed?.nextPage || null
}

function warnings(parsed) {
  return unique([
    ...(Array.isArray(parsed?.warnings) ? parsed.warnings : []),
    ...(Array.isArray(parsed?.parserWarnings) ? parsed.parserWarnings : []),
  ])
}

function imageUrls(product) {
  return unique([
    product?.homepageImage,
    product?.mainImage,
    ...(product?.candidateImages || []).map((image) => typeof image === 'string' ? image : image?.url),
    ...(product?.imageUrls || []).map((image) => typeof image === 'string' ? image : image?.url),
    ...(product?.images || []).map((image) => typeof image === 'string' ? image : image?.url),
  ])
}

function classificationCounter(classification) {
  return ({
    likely_scale: 'likelyScale',
    likely_prize: 'likelyPrize',
    unknown: 'unknown',
    other: 'other',
  })[classification] || 'unknown'
}

function isAccessFailure(error) {
  const status = Number(error?.status ?? error?.statusCode)
  if (status === 408 || status >= 500) return true
  return error?.code === 'network_error'
    || error?.code === 'ETIMEDOUT'
    || error?.code === 'ECONNRESET'
    || /^http_(?:408|5\d\d)$/.test(String(error?.code || ''))
}

async function callProgress(progress, event) {
  if (typeof progress === 'function') await progress(event)
}

export class SequentialCollector {
  constructor({
    provider,
    store,
    parsers,
    config,
    downloadImage = downloadAndStoreImage,
    fetchImpl = globalThis.fetch,
    allowPageUrl = defaultPageAllowlist,
    allowImageUrl,
    dnsLookup,
    sleep = (milliseconds, signal) => delay(milliseconds, undefined, { signal }),
    progress,
  }) {
    if (!provider) throw new Error('SequentialCollector requires a provider.')
    if (!store) throw new Error('SequentialCollector requires storage.')
    if (typeof parsers?.parseCharacterPage !== 'function') throw new Error('parseCharacterPage is required.')
    if (typeof parsers?.parseProductPage !== 'function') throw new Error('parseProductPage is required.')
    this.provider = provider
    this.store = store
    this.parsers = parsers
    this.config = config
    this.downloadImage = downloadImage
    this.fetchImpl = fetchImpl
    this.allowPageUrl = allowPageUrl
    this.allowImageUrl = allowImageUrl
    this.dnsLookup = dnsLookup
    this.sleep = sleep
    this.progress = progress
    this.lastRequestAt = 0
    this.lastFailureFingerprint = null
    this.consecutiveFailures = 0
    this.recordedRequests = new Set()
    this.providerOwnsRetries = typeof provider.scrape === 'function'
      && typeof provider.fetchPage !== 'function'
      && typeof provider.scrapePage !== 'function'
  }

  async collect({ query, characterUrl = null, limits = {}, requestedRunId = null, signal } = {}) {
    if (!query?.trim()) throw new Error('A character query is required.')
    if (characterUrl) {
      const normalizedCharacterUrl = normalizePageUrl(characterUrl)
      if (!normalizedCharacterUrl || !isCharacterUrl(normalizedCharacterUrl)) {
        throw new CollectionBlockedError('Explicit character URL is outside the credential-free Hpoi character allowlist.', {
          code: 'page_url_not_allowed',
        })
      }
      characterUrl = normalizedCharacterUrl
    }
    const effective = {
      maxImagesPerProduct: limits.maxImagesPerProduct ?? this.config?.maxImagesPerProduct ?? 5,
      maxListPages: limits.maxListPages ?? this.config?.maxListPages ?? 20,
      maxProducts: limits.maxProducts ?? this.config?.maxProducts ?? 200,
      maxRetries: limits.maxRetries ?? this.config?.maxRetries ?? 2,
      requestDelayMs: limits.requestDelayMs ?? this.config?.requestDelayMs ?? 1_500,
      requestConcurrency: 1,
      imageMaxBytes: limits.imageMaxBytes ?? this.config?.imageMaxBytes ?? 20_971_520,
    }
    const run = await this.store.createRun({
      query: query.trim(),
      characterUrl,
      limits: effective,
      requestedRunId,
    })
    const counters = {
      ...run.counters,
      likelyScale: 0,
      likelyPrize: 0,
      unknown: 0,
      other: 0,
    }
    let status = 'completed'
    let stopReason = null
    let extra = {}

    try {
      assertNotAborted(signal)
      characterUrl = await this.#resolveCharacterUrl({ query: query.trim(), characterUrl, runId: run.runId, signal })
      if (typeof characterUrl !== 'string') {
        status = characterUrl.status || 'needs_disambiguation'
        extra = { disambiguationCandidates: characterUrl.candidates }
        stopReason = status === 'not_found' ? 'character_not_found' : 'character_disambiguation_required'
        return await this.store.finalizeRun(run.runId, { status, stopReason, counters, extra })
      }
      if (!this.allowPageUrl(characterUrl)) {
        throw new CollectionBlockedError('Character URL is outside the Hpoi page allowlist.', {
          code: 'page_url_not_allowed',
          url: characterUrl,
        })
      }

      const discovered = []
      const seenPages = new Set()
      const seenProducts = new Set()
      let truncatedByProductLimit = false
      let pageUrl = characterUrl

      while (pageUrl && counters.pages < effective.maxListPages && discovered.length < effective.maxProducts) {
        assertNotAborted(signal)
        if (seenPages.has(pageUrl)) {
          await this.store.recordWarning(run.runId, { kind: 'pagination_cycle', url: pageUrl })
          break
        }
        if (!this.allowPageUrl(pageUrl)) {
          throw new CollectionBlockedError('Pagination URL is outside the Hpoi page allowlist.', {
            code: 'page_url_not_allowed',
            url: pageUrl,
          })
        }
        seenPages.add(pageUrl)

        const pageResult = await this.#requestWithRetries('character', pageUrl, effective, signal, run.runId)
        const parsed = await this.parsers.parseCharacterPage({ ...pageResult, url: pageUrl })
        const found = pageProducts(parsed)
        const additions = []
        let duplicates = 0
        for (const [foundIndex, productUrl] of found.entries()) {
          if (!this.allowPageUrl(productUrl)) {
            await this.store.recordWarning(run.runId, { kind: 'product_url_not_allowed', url: productUrl, pageUrl })
            continue
          }
          if (seenProducts.has(productUrl)) {
            duplicates += 1
            continue
          }
          seenProducts.add(productUrl)
          additions.push(productUrl)
          if (discovered.length + additions.length >= effective.maxProducts) {
            truncatedByProductLimit = found.slice(foundIndex + 1).some(
              (remainingUrl) => this.allowPageUrl(remainingUrl) && !seenProducts.has(remainingUrl),
            )
            break
          }
        }
        discovered.push(...additions)
        counters.pages += 1
        counters.productsDiscovered = discovered.length
        await this.store.recordPage(run.runId, {
          pageNumber: counters.pages,
          url: pageUrl,
          finalUrl: pageResult.finalUrl || pageUrl,
          productsFound: found.length,
          productsAdded: additions.length,
          productsDuplicate: duplicates,
          warnings: warnings(parsed),
        })
        for (const warning of warnings(parsed)) {
          await this.store.recordWarning(run.runId, { kind: 'parser', pageUrl, warning })
        }
        await this.#checkpoint(run.runId, counters, { phase: 'list', currentUrl: pageUrl })
        const explicitNext = nextPage(parsed)
        if (explicitNext && !this.allowPageUrl(explicitNext)) {
          throw new CollectionBlockedError('Next-page URL is outside the Hpoi page allowlist.', {
            code: 'page_url_not_allowed',
            url: explicitNext,
          })
        }
        pageUrl = explicitNext
      }

      if (truncatedByProductLimit || (pageUrl && (counters.pages >= effective.maxListPages || discovered.length >= effective.maxProducts))) {
        status = 'partial_by_limit'
        stopReason = truncatedByProductLimit || discovered.length >= effective.maxProducts
          ? 'max_products'
          : 'max_list_pages'
      }

      for (const productUrl of discovered) {
        assertNotAborted(signal)
        let parsedProduct
        try {
          const result = await this.#requestWithRetries('product', productUrl, effective, signal, run.runId)
          parsedProduct = await this.parsers.parseProductPage({ ...result, url: productUrl })
          this.#resetFailureSequence()
        } catch (caught) {
          const error = toCollectionError(caught, { url: productUrl })
          if (error instanceof CollectionBlockedError) throw error
          counters.productFailures += 1
          await this.store.recordFailure(run.runId, this.#failureRecord('product', productUrl, error))
          if (this.#recordFailureSequence(error) >= 3) {
            throw new CollectionBlockedError('Collection stopped after three consecutive identical access errors.', {
              code: 'consecutive_access_errors',
              url: productUrl,
              cause: error,
            })
          }
          continue
        }

        const product = {
          ...parsedProduct,
          sourceType: parsedProduct?.sourceType || 'hpoi',
          sourceUrl: parsedProduct?.sourceUrl || productUrl,
          classification: parsedProduct?.classification || 'unknown',
        }
        for (const warning of warnings(parsedProduct)) {
          await this.store.recordWarning(run.runId, { kind: 'parser', productUrl, warning })
        }
        const upsert = await this.store.upsertProduct(run.runId, product)
        counters.productsProcessed += 1
        counters[`products${upsert.state[0].toUpperCase()}${upsert.state.slice(1)}`] += 1
        counters[classificationCounter(product.classification)] += 1

        const allCandidates = imageUrls(product)
        const candidates = allCandidates.slice(0, effective.maxImagesPerProduct)
        counters.imageUrls += allCandidates.length
        if (allCandidates.length > candidates.length) {
          counters.imageUrlsOmitted = (counters.imageUrlsOmitted || 0) + allCandidates.length - candidates.length
          await this.store.recordWarning(run.runId, {
            kind: 'image_limit_reached',
            productUrl,
            discovered: allCandidates.length,
            limit: effective.maxImagesPerProduct,
            omitted: allCandidates.length - candidates.length,
          })
          if (status === 'completed') {
            status = 'partial_by_limit'
            stopReason = 'max_images_per_product'
          }
        }
        const candidateHosts = new Set([
          ...(product.discoveredImageHosts || []).map((host) => String(host).toLowerCase()),
          ...candidates.map((candidate) => {
            try { return new URL(candidate).hostname.toLowerCase() } catch { return null }
          }).filter(Boolean),
        ])
        const perProductAllowImageUrl = (candidateUrl, context = {}) => {
          if (context.sourceProductUrl !== productUrl) return false
          let allowedByDiscovery = false
          try {
            allowedByDiscovery = candidateHosts.has(new URL(candidateUrl).hostname.toLowerCase())
          } catch {
            return false
          }
          if (!allowedByDiscovery) return false
          return typeof this.allowImageUrl === 'function'
            ? this.allowImageUrl(candidateUrl, { ...context, product, discoveredImageHosts: candidateHosts })
            : true
        }
        const deferredRegistrations = []
        try {
          for (const imageUrl of candidates) {
            assertNotAborted(signal)
            try {
              await this.#throttle(effective.requestDelayMs, signal)
              const image = await this.downloadImage({
                url: imageUrl,
                sourceProductUrl: productUrl,
                productKey: upsert.productKey,
                store: this.store,
                fetchImpl: this.fetchImpl,
                allowImageUrl: perProductAllowImageUrl,
                maxBytes: effective.imageMaxBytes,
                signal,
                dnsLookup: this.dnsLookup,
                runId: run.runId,
                deferRegistration: typeof this.store.registerImages === 'function',
              })
              if (image.registrationDeferred) {
                deferredRegistrations.push({
                  runId: run.runId,
                  productKey: upsert.productKey,
                  url: image.originalUrl || imageUrl,
                  sourceProductUrl: productUrl,
                  image,
                })
                if (image.finalUrl && image.finalUrl !== (image.originalUrl || imageUrl)) {
                  deferredRegistrations.push({
                    runId: run.runId,
                    productKey: upsert.productKey,
                    url: image.finalUrl,
                    sourceProductUrl: productUrl,
                    image,
                  })
                }
              }
              counters.imagesDownloaded += 1
              this.#resetFailureSequence()
              if (image.duplicate) counters.duplicateImages += 1
              else counters.uniqueObjects += 1
            } catch (caught) {
              const error = toCollectionError(caught, { url: imageUrl })
              counters.imageFailures += 1
              await this.store.recordFailure(run.runId, this.#failureRecord('image', imageUrl, error, { productUrl }))
              if (error instanceof CollectionBlockedError) throw error
              if (isAccessFailure(error)) {
                if (this.#recordFailureSequence(error) >= 3) {
                  throw new CollectionBlockedError('Collection stopped after three consecutive identical image access errors.', {
                    code: 'consecutive_access_errors',
                    url: imageUrl,
                    cause: error,
                  })
                }
              } else {
                this.#resetFailureSequence()
              }
            }
          }
        } finally {
          if (deferredRegistrations.length > 0) {
            await this.store.registerImages(deferredRegistrations)
          }
        }
        await this.#checkpoint(run.runId, counters, {
          phase: 'product',
          currentUrl: productUrl,
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
        await this.store.recordFailure(run.runId, this.#failureRecord('run', error.url, error))
      } else {
        status = 'failed'
        stopReason = error.code || 'unexpected_error'
        await this.store.recordFailure(run.runId, this.#failureRecord('run', error.url, error))
      }
    }

    return this.store.finalizeRun(run.runId, { status, stopReason, counters, extra })
  }

  async #resolveCharacterUrl({ query, characterUrl, runId, signal }) {
    if (characterUrl) return characterUrl
    let result
    let candidates
    if (typeof this.provider.discoverCharacter === 'function') {
      try {
        result = await this.provider.discoverCharacter({ query, signal })
        await this.#recordProviderRequest(runId, result?.requestRecord)
      } catch (error) {
        await this.#recordProviderRequest(runId, error?.requestRecord)
        throw error
      }
      const blocked = detectBlockingResult(result, { url: result?.finalUrl })
      if (blocked) throw blocked
      candidates = Array.isArray(result) ? result : result?.candidates || []
    } else if (typeof this.provider.searchCharacters === 'function') {
      try {
        result = await this.provider.searchCharacters(query, { limit: 5, signal })
        await this.#recordProviderRequest(runId, result?.requestRecord)
      } catch (error) {
        await this.#recordProviderRequest(runId, error?.requestRecord)
        throw error
      }
      const blocked = detectBlockingResult(result, { url: result?.finalUrl })
      if (blocked) throw blocked
      if (typeof this.parsers.parseCharacterCandidates !== 'function') {
        throw new Error('parseCharacterCandidates is required for provider search results.')
      }
      candidates = this.parsers.parseCharacterCandidates({
        query,
        searchResults: result?.web || [],
        sourceUrl: 'https://www.hpoi.net/',
      })
      if (typeof this.parsers.resolveCharacterMatch === 'function') {
        const resolution = this.parsers.resolveCharacterMatch(candidates)
        if (resolution?.status === 'matched') return resolution.match.url
        candidates = resolution?.candidates || candidates
      }
    } else {
      const discover = this.provider.searchCharacter
      if (typeof discover !== 'function') throw new Error('Provider does not support character discovery.')
      try {
        result = await discover.call(this.provider, { query, signal })
        await this.#recordProviderRequest(runId, result?.requestRecord)
      } catch (error) {
        await this.#recordProviderRequest(runId, error?.requestRecord)
        throw error
      }
      const blocked = detectBlockingResult(result, { url: result?.finalUrl })
      if (blocked) throw blocked
      candidates = Array.isArray(result) ? result : result?.candidates || []
    }
    const safe = candidates.filter((candidate) => candidate?.url && this.allowPageUrl(candidate.url))
    for (const candidate of candidates.filter((item) => !safe.includes(item))) {
      await this.store.recordWarning(runId, { kind: 'character_candidate_url_not_allowed', url: candidate?.url || null })
    }
    if (safe.length === 1 && safe[0].highConfidence !== false && safe[0].confidence !== 'low') return safe[0].url
    return {
      status: safe.length === 0 ? 'not_found' : 'needs_disambiguation',
      candidates: safe.map(({ title, work, workName, confidence, url }) => ({
        title: title || null,
        work: work || workName || null,
        confidence: confidence || null,
        url,
      })),
    }
  }

  async #requestWithRetries(kind, url, effective, signal, runId) {
    let lastError
    const retryLimit = this.providerOwnsRetries ? 0 : effective.maxRetries
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      assertNotAborted(signal)
      try {
        await this.#throttle(effective.requestDelayMs, signal)
        const result = await this.#fetchPage(kind, url, signal)
        await this.#recordProviderRequest(runId, result?.requestRecord)
        const blocked = detectBlockingResult(result, { url })
        if (blocked) throw blocked
        if (result?.finalUrl && !this.allowPageUrl(result.finalUrl)) {
          throw new CollectionBlockedError('Page redirected outside the Hpoi allowlist.', {
            code: 'page_redirect_not_allowed',
            status: result.status ?? null,
            url: result.finalUrl,
          })
        }
        const status = Number(result?.status ?? result?.statusCode ?? 200)
        if (status >= 400) {
          const error = new Error(`Page request failed with HTTP ${status}.`)
          error.code = `http_${status}`
          error.status = status
          throw error
        }
        return result
      } catch (caught) {
        await this.#recordProviderRequest(runId, caught?.requestRecord)
        const error = toCollectionError(caught, { url })
        if (error instanceof CollectionBlockedError || error?.name === 'AbortError') throw error
        lastError = error
        if (attempt === retryLimit) break
      }
    }
    throw lastError
  }

  async #fetchPage(kind, url, signal) {
    if (typeof this.provider.fetchPage === 'function') return this.provider.fetchPage({ kind, url, signal })
    if (typeof this.provider.scrapePage === 'function') return this.provider.scrapePage({ kind, url, signal })
    const method = kind === 'character' ? this.provider.fetchCharacterPage : this.provider.fetchProductPage
    if (typeof method === 'function') {
      const result = await method.call(this.provider, { url, signal })
      return {
        ...result,
        firecrawlProduct: result?.firecrawlProduct || result?.product || null,
        status: result?.status ?? result?.requestRecord?.statusCode ?? result?.metadata?.statusCode ?? 200,
        finalUrl: result?.finalUrl || result?.requestRecord?.finalSourceUrl || result?.metadata?.sourceURL || url,
      }
    }
    if (typeof this.provider.scrape === 'function') {
      const result = await this.provider.scrape(url, {
        requestType: kind === 'character' ? 'character_page' : 'product_page',
        includeProduct: kind === 'product',
        signal,
      })
      return {
        ...result,
        firecrawlProduct: result?.product || null,
        status: result?.requestRecord?.statusCode ?? result?.metadata?.statusCode ?? 200,
        finalUrl: result?.requestRecord?.finalSourceUrl || result?.metadata?.sourceURL || url,
      }
    }
    throw new Error(`Provider does not support ${kind} page fetches.`)
  }

  async #throttle(milliseconds, signal) {
    const elapsed = Date.now() - this.lastRequestAt
    if (this.lastRequestAt && elapsed < milliseconds) await this.sleep(milliseconds - elapsed, signal)
    assertNotAborted(signal)
    this.lastRequestAt = Date.now()
  }

  #failureRecord(kind, url, error, context = {}) {
    return {
      kind,
      url: url || null,
      code: error?.code || error?.name || 'unknown_error',
      status: error?.status ?? null,
      blocked: Boolean(error?.blocked),
      message: error?.message || String(error),
      ...context,
    }
  }

  #recordFailureSequence(error) {
    const fingerprint = errorFingerprint(error)
    if (fingerprint === this.lastFailureFingerprint) this.consecutiveFailures += 1
    else {
      this.lastFailureFingerprint = fingerprint
      this.consecutiveFailures = 1
    }
    return this.consecutiveFailures
  }

  #resetFailureSequence() {
    this.lastFailureFingerprint = null
    this.consecutiveFailures = 0
  }

  async #recordProviderRequest(runId, record) {
    if (!record || typeof this.store.recordRequest !== 'function') return
    const fingerprint = [
      record.url,
      record.requestType,
      record.startedAt,
      record.endedAt,
      record.retries,
      record.firecrawlSuccess,
      record.failureCategory,
    ].join('|')
    if (this.recordedRequests.has(fingerprint)) return
    this.recordedRequests.add(fingerprint)
    await this.store.recordRequest(runId, record)
  }

  async #checkpoint(runId, counters, detail) {
    await this.store.updateRun(runId, (run) => ({ ...run, counters, progress: detail }))
    await callProgress(this.progress, { runId, counters: structuredClone(counters), ...detail })
  }
}
