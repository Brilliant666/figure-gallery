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
const summary = {
  schemaVersion: 1,
  status: browser.status === 'pass' ? 'pass' : 'fail',
  liveFetchEnabled: false,
  network: {
    hpoiRequests: unitNetwork.hpoi + Number(browserNetwork.hpoiRequests || 0),
    firecrawlRequests: unitNetwork.firecrawl + Number(browserNetwork.firecrawlRequests || 0),
    blockedExternalAttempts:
      unitNetwork.blockedExternal + Number(browserNetwork.blockedExternalAttempts || 0),
    loopbackRequests: unitNetwork.loopback + Number(browserNetwork.loopbackRequests || 0),
  },
  browser,
  runtimeStoredOutsideRepository: true,
  realPagesOrImagesStored: false,
}

if (summary.network.hpoiRequests !== 0 || summary.network.firecrawlRequests !== 0) {
  throw new Error('A forbidden Hpoi or Firecrawl request was attempted during CI.')
}
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(summary, null, 2))
