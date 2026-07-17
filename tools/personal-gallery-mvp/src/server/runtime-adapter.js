import { loadGalleryByQuery, loadRunGallery, listRecentRuns, savePreferences } from '../gallery/read-model.js'
import { OfficialWebSearchProvider } from '../providers/official-web-search-provider.js'
import { acquireCollectorLock } from '../storage/collector-lock.js'
import { GalleryStore } from '../storage/gallery-store.js'
import { readSourceStatus } from '../storage/source-status.js'
import { validateFirecrawlBaseUrl } from '../config.js'

async function findCollector() {
  const candidate = await import('../collectors/official-search-collector.js')
  if (typeof candidate.collectOfficialGallery !== 'function') {
    throw new Error('Official-source collector integration is not available.')
  }
  return candidate.collectOfficialGallery
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

export function createDefaultRuntime(
  config,
  {
    providerFactory = createCollectorProvider,
    collectorLoader = findCollector,
    storeFactory = async (root) => new GalleryStore(root).initialize(),
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
      const lock = await acquireCollectorLock(root)
      try {
        const collector = await collectorLoader()
        const requestRecords = []
        const provider = providerFactory(config, options.gate, requestRecords)
        const store = await storeFactory(root)
        const result = await collector({
          ...options,
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
    loadGalleryByQuery: (query) => loadGalleryByQuery(root, query),
    loadRunGallery: (runId) => loadRunGallery(root, runId),
    listRecentRuns: (limit) => listRecentRuns(root, limit),
    readSourceStatus: () => readSourceStatus(root),
    savePreferences: (preferences) => savePreferences(root, preferences),
  }
}
