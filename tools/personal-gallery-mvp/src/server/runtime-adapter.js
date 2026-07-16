import { loadGalleryByQuery, loadRunGallery, listRecentRuns, savePreferences } from '../gallery/read-model.js'
import {
  parseCharacterCandidates,
  parseCharacterPage,
  parseProductPage,
  resolveCharacterMatch,
} from '../parsers/index.js'
import { FirecrawlFetchProvider } from '../providers/firecrawl-fetch-provider.js'
import { acquireCollectorLock } from '../storage/collector-lock.js'
import { validateFirecrawlBaseUrl } from '../config.js'

async function findCollector() {
  for (const modulePath of ['../collectors/index.js', '../collectors/collector.js']) {
    try {
      const candidate = await import(modulePath)
      const collector = candidate.collectGallery || candidate.runCollector
      if (typeof collector === 'function') return collector
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error('Collector integration is not available.')
}

function progressForUi(event = {}) {
  const counters = event.counters || {}
  return {
    pages: counters.pages || 0,
    products: Math.max(counters.productsProcessed || 0, counters.productsDiscovered || 0),
    images: counters.imagesDownloaded || 0,
    failures: (counters.productFailures || 0) + (counters.imageFailures || 0),
    phase: event.phase || null,
  }
}

export function summarizeRequestRecords(records = []) {
  return {
    requests: records.reduce(
      (sum, record) => sum + 1 + Math.max(0, Number(record.retries) || 0),
      0,
    ),
    credits: records.reduce((sum, record) => sum + (Number(record.creditUsage) || 0), 0),
  }
}

function createCollectorProvider(config, gate, records) {
  return new FirecrawlFetchProvider({
    apiKey: config.firecrawlApiKey,
    apiUrl: validateFirecrawlBaseUrl(config.firecrawlBaseUrl),
    gate,
    maxRetries: config.maxRetries,
    requestDelayMs: config.requestDelayMs,
    logger: (record) => records.push(record),
  })
}

export function createDefaultRuntime(
  config,
  { providerFactory = createCollectorProvider, collectorLoader = findCollector } = {},
) {
  if (!config || typeof config !== 'object' || !config.root) {
    throw new Error('Default runtime requires the complete validated configuration.')
  }
  const root = config.root
  return {
    async runCollector(options) {
      if (!options.gate?.allowed) {
        throw new Error('Live gate must pass before the provider is constructed.')
      }
      const lock = await acquireCollectorLock(root)
      try {
        const collector = await collectorLoader()
        const requestRecords = []
        const provider = providerFactory(config, options.gate, requestRecords)
        const result = await collector({
          ...options,
          root,
          provider,
          parsers: {
            parseCharacterCandidates,
            resolveCharacterMatch,
            parseCharacterPage,
            parseProductPage,
          },
          config,
          progress(event) {
            options.onProgress?.(progressForUi(event))
          },
        })
        const requestSummary = summarizeRequestRecords(requestRecords)
        return {
          ...result,
          progress: progressForUi({ counters: result.counters }),
          firecrawlRequests: requestSummary.requests,
          firecrawlCredits: requestSummary.credits,
        }
      } finally {
        await lock.release()
      }
    },
    loadGalleryByQuery: (query) => loadGalleryByQuery(root, query),
    loadRunGallery: (runId) => loadRunGallery(root, runId),
    listRecentRuns: (limit) => listRecentRuns(root, limit),
    savePreferences: (preferences) => savePreferences(root, preferences),
  }
}
