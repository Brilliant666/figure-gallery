import { loadGalleryByQuery, loadRunGallery, listRecentRuns, savePreferences } from '../gallery/read-model.js'
import { OfficialWebSearchProvider } from '../providers/official-web-search-provider.js'
import { HpoiIndexDiscoveryProvider } from '../providers/hpoi-index-discovery-provider.js'
import { acquireCollectorLock } from '../storage/collector-lock.js'
import { GalleryStore } from '../storage/gallery-store.js'
import { DiscoveryStore } from '../storage/discovery-store.js'
import { readSourceStatus } from '../storage/source-status.js'
import { validateFirecrawlBaseUrl } from '../config.js'
import {
  createLocalCharacterConfig,
  listCharacterConfigs,
  resolveCharacterConfig,
} from '../storage/character-store.js'
import { validateCharacterConfig } from '../characters/registry.js'

async function findCollector() {
  const candidate = await import('../collectors/official-search-collector.js')
  if (typeof candidate.collectOfficialGallery !== 'function') {
    throw new Error('Official-source collector integration is not available.')
  }
  return candidate.collectOfficialGallery
}

async function findIndexCollector() {
  const candidate = await import('../collectors/hpoi-index-collector.js')
  if (typeof candidate.collectHpoiIndexGallery !== 'function') {
    throw new Error('Hpoi search-index collector integration is not available.')
  }
  return candidate.collectHpoiIndexGallery
}

function physicalAttempts(record = {}) {
  return 1 + Math.max(0, Number(record.retries) || 0)
}

function progressForUi(event = {}) {
  const counters = event.counters || {}
  return {
    pages:
      (Number(counters.searchRequests) || 0) + (Number(counters.scrapeRequests) || 0) ||
      Number(counters.pages) ||
      0,
    products: Math.max(
      Number(counters.productsProcessed) || 0,
      Number(counters.productsDiscovered) || 0,
    ),
    images: Number(counters.imagesDownloaded) || 0,
    failures: (Number(counters.productFailures) || 0) + (Number(counters.imageFailures) || 0),
    phase: event.phase || null,
  }
}

export function summarizeRequestRecords(records = []) {
  const byType = (requestType) => records
    .filter((record) => record.requestType === requestType)
    .reduce((sum, record) => sum + physicalAttempts(record), 0)
  return {
    requests: records.reduce((sum, record) => sum + physicalAttempts(record), 0),
    searchRequests: byType('official_search'),
    scrapeRequests: byType('official_product'),
    credits: records.reduce((sum, record) => sum + (Number(record.creditUsage) || 0), 0),
  }
}

function createCollectorProvider(config, gate, records) {
  return new OfficialWebSearchProvider({
    apiKey: config.firecrawlApiKey,
    apiUrl: validateFirecrawlBaseUrl(config.firecrawlBaseUrl),
    gate,
    maxRetries: config.officialMaxRetries,
    requestDelayMs: config.officialRequestDelayMs,
    logger: (record) => records.push(record),
  })
}

function createIndexProvider(config, gate, records) {
  return new HpoiIndexDiscoveryProvider({
    apiKey: config.firecrawlApiKey,
    apiUrl: validateFirecrawlBaseUrl(config.firecrawlBaseUrl),
    gate,
    maxRetries: config.officialMaxRetries,
    requestDelayMs: config.hpoiIndexRequestDelayMs,
    logger: (record) => records.push(record),
  })
}

export function createDefaultRuntime(
  config,
  {
    providerFactory = createCollectorProvider,
    indexProviderFactory = createIndexProvider,
    collectorLoader = findCollector,
    indexCollectorLoader = findIndexCollector,
    storeFactory = async (root, characterConfig) => new GalleryStore(root, { characterConfig }).initialize(),
    discoveryStoreFactory = async (root, characterConfig) => new DiscoveryStore(root, { characterConfig }).initialize(),
  } = {},
) {
  if (!config || typeof config !== 'object' || !config.root) {
    throw new Error('Default runtime requires the complete validated configuration.')
  }
  const root = config.root
  return {
    async runCollector(options = {}) {
      if (!options.gate?.allowed) {
        throw new Error('Official live gate must pass before the provider is constructed.')
      }
      if (options.characterUrl || (options.sourceMode && options.sourceMode !== 'official_sources')) {
        throw new Error('The runtime accepts only official-source collection; Hpoi live access is disabled.')
      }
      const characterConfig = validateCharacterConfig(
        options.characterConfig || await resolveCharacterConfig(root, options.query),
      )
      const lock = await acquireCollectorLock(root)
      try {
        const collector = await collectorLoader()
        const requestRecords = []
        const provider = providerFactory(config, options.gate, requestRecords)
        const store = await storeFactory(root, characterConfig)
        const result = await collector({
          ...options,
          characterConfig,
          root,
          provider,
          store,
          config,
          progress(event) {
            options.onProgress?.(progressForUi(event))
          },
        })
        const requestSummary = summarizeRequestRecords(requestRecords)
        return {
          ...result,
          progress: progressForUi({ counters: result.counters }),
          hpoiRequests: 0,
          firecrawlRequests: requestSummary.requests,
          firecrawlSearchRequests: requestSummary.searchRequests,
          firecrawlScrapeRequests: requestSummary.scrapeRequests,
          firecrawlCredits: requestSummary.credits,
        }
      } finally {
        await lock.release()
      }
    },
    async runIndexDiscovery(options = {}) {
      if (!options.gate?.allowed) {
        throw new Error('Hpoi index discovery gate must pass before providers are constructed.')
      }
      if (options.characterUrl || (options.sourceMode && options.sourceMode !== 'hpoi_search_index')) {
        throw new Error('Index discovery accepts only the hpoi_search_index source mode and never a Hpoi target URL.')
      }
      const characterConfig = validateCharacterConfig(
        options.characterConfig || await resolveCharacterConfig(root, options.query),
      )
      const lock = await acquireCollectorLock(root)
      try {
        const collector = await indexCollectorLoader()
        const requestRecords = []
        const indexProvider = indexProviderFactory(config, options.gate, requestRecords)
        const officialProvider = providerFactory({
          ...config,
          // Search and scrape share Firecrawl's account-level rate budget.
          // Keep official resolution at the same conservative cadence as the
          // preceding index searches for this combined pipeline.
          officialRequestDelayMs: Math.max(
            Number(config.officialRequestDelayMs) || 1_000,
            Number(config.hpoiIndexRequestDelayMs) || 7_000,
          ),
        }, options.gate, requestRecords)
        const galleryStore = await storeFactory(root, characterConfig)
        const discoveryStore = await discoveryStoreFactory(root, characterConfig)
        const result = await collector({
          ...options,
          characterConfig,
          root,
          indexProvider,
          officialProvider,
          galleryStore,
          discoveryStore,
          config,
          progress(event) {
            options.onProgress?.({
              ...progressForUi(event),
              candidates: Number(event?.candidates) || 0,
            })
          },
        })
        return {
          ...result,
          progress: {
            pages: Number(result?.requestSummary?.searchRequests || 0) + Number(result?.requestSummary?.scrapeRequests || 0),
            products: Number(result?.metrics?.afterProducts) || 0,
            images: Number(result?.metrics?.afterImages) || 0,
            failures: Number(result?.resolutionFailures) || 0,
            candidates: Number(result?.metrics?.hpoiIndexedCandidates) || 0,
          },
          hpoiRequests: 0,
          hpoiDirectHttpRequests: 0,
          hpoiDirectBrowserNavigations: 0,
          hpoiScrapeRequests: 0,
          hpoiApiRequests: 0,
          firecrawlRequests: Number(result?.requestSummary?.searchRequests || 0) + Number(result?.requestSummary?.scrapeRequests || 0),
          firecrawlSearchRequests: Number(result?.requestSummary?.searchRequests) || 0,
          firecrawlScrapeRequests: Number(result?.requestSummary?.scrapeRequests) || 0,
          firecrawlCredits: Number(result?.requestSummary?.credits) || 0,
        }
      } finally {
        await lock.release()
      }
    },
    loadGalleryByQuery: (query) => loadGalleryByQuery(root, query),
    loadRunGallery: (runId) => loadRunGallery(root, runId),
    listRecentRuns: (limit) => listRecentRuns(root, limit),
    listCharacters: () => listCharacterConfigs(root),
    resolveCharacter: (value) => resolveCharacterConfig(root, value),
    createCharacter: (value) => createLocalCharacterConfig(root, value),
    async loadDiscovery(value) {
      const characterConfig = await resolveCharacterConfig(root, value)
      if (!characterConfig) return null
      return new DiscoveryStore(root, { characterConfig }).initialize().then((store) => store.readView())
    },
    readSourceStatus: () => readSourceStatus(root),
    savePreferences: (characterSlug, preferences) => savePreferences(root, characterSlug, preferences),
  }
}
