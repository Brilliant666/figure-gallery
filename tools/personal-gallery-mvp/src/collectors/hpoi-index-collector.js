import { randomUUID } from 'node:crypto'

import { createDiscoveryCandidate } from '../discovery/hpoi-index.js'
import {
  buildOfficialResolutionQueries,
  matchCandidateToProducts,
  rankOfficialResolution,
} from '../discovery/matching.js'
import { loadGalleryByQuery } from '../gallery/read-model.js'
import { validateCharacterConfig } from '../characters/registry.js'
import { OfficialSearchCollector } from './official-search-collector.js'

function nowIso() {
  return new Date().toISOString()
}

function countImages(gallery) {
  return Number(gallery?.summary?.images) || 0
}

function countProducts(gallery) {
  return Number(gallery?.summary?.products) || 0
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))]
}

function runId() {
  return `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID()}`
}

function coverageRates(metrics) {
  const ratio = (numerator, denominator) => denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null
  return {
    resolutionRate: ratio(metrics.officialResolved, metrics.newTargets),
    collectionRate: ratio(metrics.collected, metrics.newTargets),
    existingCoverageRate: ratio(metrics.alreadyCollected, metrics.inScope),
  }
}

function metricsFor(candidates, beforeGallery, afterGallery) {
  const observed = candidates.filter((candidate) => candidate.observedInCurrentRun !== false)
  const metrics = {
    hpoiIndexedCandidates: observed.length,
    inScope: observed.filter((candidate) => candidate.scopeStatus === 'in_scope').length,
    alreadyCollected: observed.filter((candidate) => candidate.targetDisposition === 'already_collected').length,
    newTargets: observed.filter((candidate) => candidate.targetDisposition === 'new_target').length,
    officialResolved: observed.filter((candidate) => (candidate.resolutionEvidence || []).some((item) => item?.officialUrl)).length,
    collected: observed.filter((candidate) => candidate.status === 'collected').length,
    unresolved: observed.filter((candidate) => candidate.status === 'needs_resolution' || candidate.status === 'official_resolved').length,
    outOfScope: observed.filter((candidate) => candidate.scopeStatus === 'out_of_scope').length,
    ambiguous: observed.filter((candidate) => candidate.scopeStatus === 'ambiguous' || candidate.status === 'ambiguous').length,
    beforeProducts: countProducts(beforeGallery),
    beforeImages: countImages(beforeGallery),
    afterProducts: countProducts(afterGallery),
    afterImages: countImages(afterGallery),
  }
  return { ...metrics, ...coverageRates(metrics) }
}

function safeFailure(error) {
  return {
    code: error?.category || error?.code || error?.name || 'unknown_error',
    blocked: Boolean(error?.blocked),
    statusCode: Number.isInteger(Number(error?.statusCode)) ? Number(error.statusCode) : null,
    message: String(error?.message || 'Unknown discovery error').slice(0, 300),
  }
}

export class HpoiIndexCollector {
  constructor({
    indexProvider,
    officialProvider,
    galleryStore,
    discoveryStore,
    root,
    config,
    galleryLoader = loadGalleryByQuery,
    officialCollectorFactory = (options) => new OfficialSearchCollector(options),
    progress,
  } = {}) {
    if (!indexProvider || typeof indexProvider.discoverCharacter !== 'function') throw new Error('HpoiIndexCollector requires HpoiIndexDiscoveryProvider.')
    if (!officialProvider || typeof officialProvider.searchOfficialProducts !== 'function') throw new Error('HpoiIndexCollector requires OfficialWebSearchProvider.')
    if (!galleryStore || typeof galleryStore.upsertProduct !== 'function') throw new Error('HpoiIndexCollector requires GalleryStore.')
    if (!discoveryStore || typeof discoveryStore.upsertCandidates !== 'function') throw new Error('HpoiIndexCollector requires DiscoveryStore.')
    this.indexProvider = indexProvider
    this.officialProvider = officialProvider
    this.galleryStore = galleryStore
    this.discoveryStore = discoveryStore
    this.root = root
    this.config = config || {}
    this.galleryLoader = galleryLoader
    this.officialCollectorFactory = officialCollectorFactory
    this.progress = progress
  }

  async collect({ query, characterConfig, limits = {}, requestedRunId = null, signal } = {}) {
    const character = validateCharacterConfig(characterConfig)
    const discoveryRunId = requestedRunId || runId()
    const startedAt = nowIso()
    const beforeGallery = await this.galleryLoader(this.root, character.slug)
    const beforePreferences = structuredClone(beforeGallery?.preferences || null)
    const requestRecords = []
    const onRequest = (record) => { if (record) requestRecords.push(record) }
    let discovery
    let runStatus = 'completed'
    let stopReason = null
    let upsertSummary = { created: 0, updated: 0, candidates: [] }
    let officialCollection = null
    let resolutionSearches = 0
    let resolutionFailures = 0

    try {
      this.progress?.({ phase: 'hpoi_index_discovery', candidates: 0, products: countProducts(beforeGallery), images: countImages(beforeGallery) })
      discovery = await this.indexProvider.discoverCharacter(character, {
        maxQueries: Number(limits.maxIndexQueries || this.config.hpoiIndexMaxQueries || 30),
        maxResultsPerQuery: Number(limits.maxIndexResultsPerQuery || this.config.hpoiIndexMaxResultsPerQuery || 10),
        maxRawResults: Number(limits.maxIndexRawResults || this.config.hpoiIndexMaxRawResults || 200),
        signal,
        onRequest,
      })
      const candidates = discovery.candidates
        .map((entry) => createDiscoveryCandidate(entry, character))
        .filter(Boolean)
        .map((candidate) => ({
          ...candidate,
          scopeStatus: candidate.status,
          observedInCurrentRun: true,
          lastDiscoveryRunId: discoveryRunId,
        }))
      upsertSummary = await this.discoveryStore.upsertCandidates(candidates)
      this.progress?.({ phase: 'candidate_matching', candidates: candidates.length, products: countProducts(beforeGallery), images: countImages(beforeGallery) })

      const persisted = await this.discoveryStore.loadCandidates()
      const observedIds = new Set(candidates.map((candidate) => candidate.candidateId))
      const observedCandidates = persisted.candidates.filter((candidate) => observedIds.has(candidate.candidateId))
      for (const candidate of observedCandidates) {
        if (candidate.scopeStatus !== 'in_scope') continue
        if (candidate.status === 'collected' || candidate.status === 'already_collected') continue
        const match = matchCandidateToProducts(candidate, beforeGallery?.products || [])
        await this.discoveryStore.updateCandidate(candidate.candidateId, (current) => ({
          ...current,
          targetDisposition: match.kind === 'new_target'
            ? 'new_target'
            : match.kind === 'ambiguous' ? 'ambiguous' : 'already_collected',
          matchKind: match.kind,
          matchScore: match.score,
          matchedProductId: match.productId,
          status: match.kind === 'new_target'
            ? 'needs_resolution'
            : match.kind === 'ambiguous' ? 'ambiguous' : 'already_collected',
          statusReason: match.kind,
        }))
      }

      const matched = await this.discoveryStore.loadCandidates()
      const resolutionTargets = matched.candidates.filter((candidate) =>
        observedIds.has(candidate.candidateId)
        && candidate.scopeStatus === 'in_scope'
        && candidate.targetDisposition === 'new_target'
        && candidate.status === 'needs_resolution'
        && !candidate.resolutionAttemptedAt,
      )
      const resolvedUrls = []
      for (const candidate of resolutionTargets) {
        const queries = buildOfficialResolutionQueries(candidate, character, { maxQueries: 3 })
        let selected = null
        let lastFailure = null
        for (const resolutionQuery of queries) {
          try {
            const response = await this.officialProvider.searchOfficialProducts(resolutionQuery, {
              limit: Math.min(10, Number(limits.maxOfficialResultsPerQuery || this.config.officialMaxSearchResultsPerQuery || 10)),
              signal,
            })
            onRequest(response.requestRecord)
            resolutionSearches += 1
            const ranked = rankOfficialResolution(candidate, character, response.candidates || [])
            selected = ranked[0] || null
            if (selected) break
          } catch (error) {
            onRequest(error?.requestRecord)
            lastFailure = safeFailure(error)
            resolutionFailures += 1
            if (error?.blocked || signal?.aborted || error?.name === 'AbortError') throw error
          }
        }
        const attemptedAt = nowIso()
        if (!selected) {
          await this.discoveryStore.updateCandidate(candidate.candidateId, (current) => ({
            ...current,
            status: 'needs_resolution',
            statusReason: lastFailure?.code || 'no_reviewed_official_result',
            resolutionAttemptedAt: attemptedAt,
            resolutionQueries: queries,
            resolutionFailure: lastFailure,
          }))
          continue
        }
        const evidence = {
          officialUrl: selected.officialUrl,
          sourceDomain: selected.sourceDomain,
          query: selected.discoveryQuery || queries[0],
          score: selected.score,
          resolvedAt: attemptedAt,
        }
        resolvedUrls.push(selected.officialUrl)
        await this.discoveryStore.updateCandidate(candidate.candidateId, (current) => ({
          ...current,
          status: 'official_resolved',
          statusReason: 'reviewed_official_source_resolved',
          resolutionAttemptedAt: attemptedAt,
          resolutionQueries: queries,
          resolutionEvidence: [...(current.resolutionEvidence || []), evidence],
          resolutionFailure: null,
        }))
      }

      const uniqueResolvedUrls = unique(resolvedUrls)
      if (uniqueResolvedUrls.length) {
        this.progress?.({ phase: 'official_collection', candidates: candidates.length, products: countProducts(beforeGallery), images: countImages(beforeGallery) })
        const collector = this.officialCollectorFactory({
          provider: this.officialProvider,
          store: this.galleryStore,
          config: this.config,
          progress: (event) => this.progress?.({ ...event, phase: `official_${event.phase || 'collection'}` }),
        })
        officialCollection = await collector.collect({
          query: String(query || character.displayName),
          characterConfig: character,
          seedUrls: uniqueResolvedUrls,
          limits: {
            skipSearch: true,
            includeReviewedSeeds: false,
            writeCoverage: false,
            sourceMode: 'hpoi_index_official_resolution',
            searchLimit: 1,
            maxCandidates: Math.max(1, uniqueResolvedUrls.length),
            maxProducts: Math.max(1, uniqueResolvedUrls.length),
            maxImagesPerProduct: Number(limits.maxImagesPerProduct || this.config.officialMaxImagesPerProduct || 10),
            requestDelayMs: Number(this.config.officialRequestDelayMs || 1_000),
            imageRequestDelayMs: Number(this.config.officialImageRequestDelayMs || 1_000),
            imageMaxBytes: Number(this.config.imageMaxBytes || 20_971_520),
          },
          signal,
        })
        await this.galleryStore.includeExistingProducts?.(
          officialCollection.runId,
          (beforeGallery?.products || []).map((product) => product.id),
        )
      }

      const afterResolutionGallery = await this.galleryLoader(this.root, character.slug)
      const refreshed = await this.discoveryStore.loadCandidates()
      for (const candidate of refreshed.candidates.filter((item) => observedIds.has(item.candidateId))) {
        if (!(candidate.resolutionEvidence || []).some((entry) => entry?.officialUrl)) continue
        const match = matchCandidateToProducts(candidate, afterResolutionGallery?.products || [])
        if (!match.productId) continue
        await this.discoveryStore.updateCandidate(candidate.candidateId, (current) => ({
          ...current,
          status: 'collected',
          statusReason: 'official_source_collected',
          matchKind: match.kind,
          matchScore: match.score,
          matchedProductId: match.productId,
          collectedAt: current.collectedAt || nowIso(),
        }))
      }
    } catch (error) {
      if (error?.partialDiscovery) {
        discovery = error.partialDiscovery
        const partialCandidates = (discovery.candidates || [])
          .map((entry) => createDiscoveryCandidate(entry, character))
          .filter(Boolean)
          .map((candidate) => ({
            ...candidate,
            scopeStatus: candidate.status,
            observedInCurrentRun: true,
            lastDiscoveryRunId: discoveryRunId,
          }))
        upsertSummary = await this.discoveryStore.upsertCandidates(partialCandidates)
      }
      runStatus = error?.name === 'AbortError' || signal?.aborted ? 'stopped' : error?.blocked ? 'blocked' : 'failed'
      stopReason = safeFailure(error)
    }

    const afterGallery = await this.galleryLoader(this.root, character.slug)
    const finalManifest = await this.discoveryStore.loadCandidates()
    const observedIds = new Set((discovery?.candidates || []).map((entry) => createDiscoveryCandidate(entry, character)?.candidateId).filter(Boolean))
    const observed = finalManifest.candidates
      .filter((candidate) => observedIds.has(candidate.candidateId))
      .map((candidate) => ({ ...candidate, observedInCurrentRun: true }))
    const metrics = metricsFor(observed, beforeGallery, afterGallery)
    const directAccess = {
      hpoiDirectHttpRequests: 0,
      hpoiDirectBrowserNavigations: 0,
      hpoiScrapeRequests: 0,
      hpoiApiRequests: 0,
    }
    const preferencesPreserved = JSON.stringify(beforePreferences) === JSON.stringify(afterGallery?.preferences || null)
    const requestSummary = {
      searchRequests: requestRecords.reduce((sum, record) => sum + (record?.requestType?.includes('search') ? 1 + Math.max(0, Number(record.retries) || 0) : 0), 0),
      hpoiIndexSearchRequests: requestRecords.reduce((sum, record) => sum + (record?.requestType === 'hpoi_index_search' ? 1 + Math.max(0, Number(record.retries) || 0) : 0), 0),
      officialResolutionSearchRequests: requestRecords.reduce((sum, record) => sum + (record?.requestType === 'official_search' ? 1 + Math.max(0, Number(record.retries) || 0) : 0), 0),
      scrapeRequests: Number(officialCollection?.counters?.scrapeRequests) || 0,
      credits: requestRecords.reduce((sum, record) => sum + Math.max(0, Number(record?.creditUsage) || 0), 0)
        + (Number(officialCollection?.counters?.firecrawlCredits) || 0),
      creditUsageKind: requestRecords.some((record) => record?.creditUsageKind === 'estimated_upper_bound')
        ? 'estimated_upper_bound'
        : requestRecords.some((record) => record?.creditUsageKind === 'reported_plus_estimated_retries')
          ? 'reported_plus_estimated_retries'
          : requestRecords.length ? 'reported' : 'none',
    }
    const coverage = await this.discoveryStore.writeCoverage({
      runId: discoveryRunId,
      status: runStatus,
      scope: 'current_hpoi_search_index_candidate_set_not_absolute_hpoi_database_coverage',
      metrics,
      directAccess,
      requestSummary,
      preferencesPreserved,
    })
    const result = await this.discoveryStore.writeRun(discoveryRunId, {
      query: String(query || character.displayName),
      status: runStatus,
      stopReason,
      startedAt,
      completedAt: nowIso(),
      queryCount: discovery?.queries?.length || 0,
      querySummaries: discovery?.querySummaries || [],
      rawResults: discovery?.rawResults || 0,
      duplicateResults: discovery?.duplicateResults || 0,
      rejectedResults: discovery?.rejectedResults || 0,
      candidateIds: observed.map((candidate) => candidate.candidateId),
      candidateCreated: upsertSummary.created || 0,
      resolutionSearches,
      resolutionFailures,
      officialCollectionRunId: officialCollection?.runId || null,
      officialCollectionStatus: officialCollection?.status || null,
      newProducts: Number(officialCollection?.counters?.productsNew) || 0,
      changedProducts: Number(officialCollection?.counters?.productsChanged) || 0,
      unchangedProducts: Number(officialCollection?.counters?.productsUnchanged) || 0,
      newObjects: Number(officialCollection?.counters?.uniqueObjects) || 0,
      duplicateImages: Number(officialCollection?.counters?.duplicateImages) || 0,
      metrics,
      directAccess,
      requestSummary,
      preferencesPreserved,
    })
    this.progress?.({ phase: 'completed', candidates: metrics.hpoiIndexedCandidates, products: metrics.afterProducts, images: metrics.afterImages })
    return { ...result, coverage }
  }
}

export async function collectHpoiIndexGallery(options = {}) {
  return new HpoiIndexCollector(options).collect(options)
}
