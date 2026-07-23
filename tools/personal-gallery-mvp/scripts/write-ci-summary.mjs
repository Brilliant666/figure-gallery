import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

const output = process.env.MVP_CI_SUMMARY
const browserFile = process.env.MVP_BROWSER_RESULT
const networkDirectory = process.env.MVP_NETWORK_RESULT_DIR
if (!output || !browserFile || !networkDirectory) {
  throw new Error('MVP_CI_SUMMARY, MVP_BROWSER_RESULT, and MVP_NETWORK_RESULT_DIR are required.')
}

const browser = readJson(browserFile)
const networkFiles = readdirSync(networkDirectory)
  .filter((name) => name.endsWith('.json'))
  .map((name) => readJson(path.join(networkDirectory, name)))
if (!networkFiles.length) throw new Error('No unit-test network guard summaries were produced.')

const unitNetwork = networkFiles.reduce(
  (total, item) => {
    for (const key of ['blockedExternal', 'firecrawl', 'hpoi', 'loopback']) {
      total[key] += Number(item[key] || 0)
    }
    return total
  },
  { blockedExternal: 0, firecrawl: 0, hpoi: 0, loopback: 0 },
)
const browserNetwork = browser.network || {}
const hpoiRequests = unitNetwork.hpoi + Number(browserNetwork.hpoiRequests || 0)
const firecrawlRequests = unitNetwork.firecrawl + Number(browserNetwork.firecrawlRequests || 0)
const blockedExternalAttempts =
  unitNetwork.blockedExternal + Number(browserNetwork.blockedExternalAttempts || 0)
const browserExternalRequests = Number(browserNetwork.externalRequests || 0)
const externalRequests = blockedExternalAttempts + browserExternalRequests
const summary = {
  schemaVersion: 2,
  task: 'MVP-02',
  scope: 'offline_ci_only',
  status: browser.status === 'pass' ? 'pass' : 'fail',
  mvp02OverallStatus: 'not_run',
  realRunStatus: 'not_run',
  liveFetchEnabled: false,
  officialLiveFetchEnabled: false,
  hpoi: {
    status: 'blocked_by_source',
    stopReason: 'captcha',
    retryAllowed: false,
  },
  network: {
    hpoiRequests,
    firecrawlRequests,
    officialExternalRequests: externalRequests,
    externalRequests,
    blockedExternalAttempts,
    loopbackRequests: unitNetwork.loopback + Number(browserNetwork.loopbackRequests || 0),
  },
  browser,
  fixture: 'synthetic_official_style_html_json_and_png_only',
  runtimeStoredOutsideRepository: true,
  realPagesOrImagesStored: false,
}

if (
  summary.network.hpoiRequests !== 0 ||
  summary.network.firecrawlRequests !== 0 ||
  summary.network.officialExternalRequests !== 0 ||
  summary.network.externalRequests !== 0
) {
  throw new Error('An external Hpoi, Firecrawl, or official-source request was attempted during offline CI.')
}
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(summary, null, 2))
