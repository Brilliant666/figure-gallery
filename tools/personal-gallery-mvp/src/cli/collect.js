#!/usr/bin/env node
import process from 'node:process'
import { Command } from 'commander'

import { hpoiIndexLiveGate, loadConfig, officialLiveGate } from '../config.js'
import { createDefaultRuntime } from '../server/runtime-adapter.js'

const config = loadConfig()
const program = new Command()
  .name('personal-gallery-collect')
  .description('Discover indexed Hpoi candidate URLs without visiting Hpoi, then build a bounded gallery from reviewed official pages.')
  .argument('[query]', 'character name (also accepted positionally for Windows npm forwarding)')
  .option('--query <name>', 'character name')
  .option(
    '--max-search-results <count>',
    'maximum results returned for each multilingual search query',
    String(config.officialMaxSearchResultsPerQuery),
  )
  .option('--max-candidates <count>', 'maximum deduplicated official candidate URLs', String(config.officialMaxCandidates))
  .option('--max-products <count>', 'maximum official product pages', String(config.officialMaxProducts))
  .option(
    '--max-images-per-product <count>',
    'maximum public product images per official product page',
    String(config.officialMaxImagesPerProduct),
  )
  .option('--seed-official-url <url...>', 'explicit allowlisted official product URL fallback')
  .option('--official-only', 'skip Hpoi search-index discovery and run the legacy reviewed-official search path')
  .option('--max-index-queries <count>', 'maximum deterministic site:hpoi.net Search queries', String(config.hpoiIndexMaxQueries))
  .option('--max-index-results <count>', 'maximum Search results per index query', String(config.hpoiIndexMaxResultsPerQuery))
  .option('--max-index-raw-results <count>', 'maximum raw index results before URL dedupe', String(config.hpoiIndexMaxRawResults))
  .option(
    '--confirm-hpoi-index-discovery',
    'confirm Search may return Hpoi URL strings while direct Hpoi transport remains forbidden',
  )
  .option(
    '--confirm-official-source-access',
    'confirm this owner-initiated run may access only public allowlisted official product pages',
  )

program.parse()
const options = program.opts()
const query = options.query || program.args[0] || config.defaultQuery
const sourceMode = options.officialOnly ? 'official_sources' : 'hpoi_search_index'
const gate = sourceMode === 'hpoi_search_index'
  ? hpoiIndexLiveGate(config, {
      interactiveIndexConfirmation: options.confirmHpoiIndexDiscovery === true,
      interactiveOfficialConfirmation: options.confirmOfficialSourceAccess === true,
    })
  : officialLiveGate(config, {
      interactiveConfirmation: options.confirmOfficialSourceAccess === true,
    })

if (!gate.allowed) {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'environment_blocked',
        query,
        sourceMode,
        hpoiStatus: 'blocked_by_source',
        missing: gate.missing,
        notice: gate.notice,
        hpoiRequests: 0,
        hpoiDirectHttpRequests: 0,
        hpoiDirectBrowserNavigations: 0,
        hpoiScrapeRequests: 0,
        hpoiApiRequests: 0,
        firecrawlSearchRequests: 0,
        firecrawlScrapeRequests: 0,
        firecrawlRequests: 0,
      },
      null,
      2,
    )}\n`,
  )
} else {
  const integer = (value, name, max) => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
      throw new Error(`${name} must be an integer from 1 through ${max}.`)
    }
    return parsed
  }
  const runtime = createDefaultRuntime(config)
  const run = sourceMode === 'hpoi_search_index'
    ? runtime.runIndexDiscovery.bind(runtime)
    : runtime.runCollector.bind(runtime)
  const result = await run({
    query,
    sourceMode,
    seedUrls: options.seedOfficialUrl || [],
    gate,
    limits: {
      searchLimit: integer(
        options.maxSearchResults,
        'max-search-results',
        config.officialMaxSearchResultsPerQuery,
      ),
      maxIndexQueries: integer(options.maxIndexQueries, 'max-index-queries', config.hpoiIndexMaxQueries),
      maxIndexResultsPerQuery: integer(options.maxIndexResults, 'max-index-results', config.hpoiIndexMaxResultsPerQuery),
      maxIndexRawResults: integer(options.maxIndexRawResults, 'max-index-raw-results', config.hpoiIndexMaxRawResults),
      maxQueries: config.officialMaxQueries,
      maxCandidates: integer(options.maxCandidates, 'max-candidates', config.officialMaxCandidates),
      maxProducts: integer(options.maxProducts, 'max-products', config.officialMaxProducts),
      maxImagesPerProduct: integer(
        options.maxImagesPerProduct,
        'max-images-per-product',
        config.officialMaxImagesPerProduct,
      ),
      requestDelayMs: config.officialRequestDelayMs,
      imageRequestDelayMs: config.officialImageRequestDelayMs,
      imageMaxBytes: config.imageMaxBytes,
    },
    onProgress(progress) {
      process.stdout.write(`${JSON.stringify({ type: 'progress', ...progress })}\n`)
    },
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
