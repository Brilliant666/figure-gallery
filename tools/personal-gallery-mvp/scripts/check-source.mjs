import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(toolRoot, '..', '..')

function fail(message) {
  throw new Error(message)
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
}

function walk(directory) {
  if (!statSync(directory).isDirectory()) return [directory]
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return []
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

const packageJson = JSON.parse(readFileSync(path.join(toolRoot, 'package.json'), 'utf8'))
const expectedDependencies = {
  '@mendable/firecrawl-js': '4.30.0',
  cheerio: '1.2.0',
  commander: '15.0.0',
  sharp: '0.35.3',
}
const expectedDevDependencies = { '@playwright/test': '1.61.1' }
if (JSON.stringify(packageJson.dependencies) !== JSON.stringify(expectedDependencies)) {
  fail('The MVP direct production dependencies or exact pins changed.')
}
if (JSON.stringify(packageJson.devDependencies) !== JSON.stringify(expectedDevDependencies)) {
  fail('The MVP direct development dependencies or exact pins changed.')
}

const lock = JSON.parse(readFileSync(path.join(toolRoot, 'package-lock.json'), 'utf8'))
if (lock.lockfileVersion !== 3 || lock.packages?.['']?.name !== packageJson.name) {
  fail('The independent npm lockfile is missing or invalid.')
}

const officialProviderText = readFileSync(
  path.join(toolRoot, 'src', 'providers', 'official-web-search-provider.js'),
  'utf8',
)
const officialUrlsText = readFileSync(
  path.join(toolRoot, 'src', 'parsers', 'official-urls.js'),
  'utf8',
)
const configText = readFileSync(path.join(toolRoot, 'src', 'config.js'), 'utf8')
const envExampleText = readFileSync(path.join(toolRoot, '.env.example'), 'utf8')
const workflowText = readFileSync(
  path.join(repositoryRoot, '.github', 'workflows', 'personal-gallery-mvp-ci.yml'),
  'utf8',
)

const expectedOfficialQueries = [
  '"Azur Lane" Cheshire figure',
  '"Azur Lane" Cheshire scale figure',
  'アズールレーン チェシャー フィギュア',
  '碧蓝航线 柴郡 手办',
  '碧蓝航线 柴郡 比例手办',
]
const officialQueriesBlock = officialProviderText.match(
  /export const OFFICIAL_DISCOVERY_QUERIES = Object\.freeze\(\[([\s\S]*?)\]\)/,
)
const actualOfficialQueries = officialQueriesBlock
  ? [...officialQueriesBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  : []
if (JSON.stringify(actualOfficialQueries) !== JSON.stringify(expectedOfficialQueries)) {
  fail('The ordered MVP-02 multilingual discovery query set changed.')
}

if (
  !officialProviderText.includes("sources: ['web']") ||
  !officialProviderText.includes("excludeDomains: ['hpoi.net', 'www.hpoi.net']")
) {
  fail('Official discovery must use Firecrawl Search v2 web results and explicitly exclude Hpoi.')
}

const officialClientMethods = [
  ...officialProviderText.matchAll(/this\.client\.([A-Za-z][A-Za-z0-9]*)\s*\(/g),
].map((match) => match[1])
if (
  !officialClientMethods.includes('search') ||
  !officialClientMethods.includes('scrape') ||
  officialClientMethods.some((method) => !['search', 'scrape'].includes(method))
) {
  fail(`Official Firecrawl methods must be exactly search and scrape: ${officialClientMethods.join(', ')}`)
}

const expectedOfficialHosts = [
  'goodsmile.com',
  'www.goodsmile.com',
  'goodsmilearts.com',
  'www.goodsmilearts.com',
  'alter-web.jp',
  'www.alter-web.jp',
]
const officialHostsBlock = officialUrlsText.match(/const OFFICIAL_HOSTS = new Set\(\[([\s\S]*?)\]\)/)
const actualOfficialHosts = officialHostsBlock
  ? [...officialHostsBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  : []
if (JSON.stringify(actualOfficialHosts) !== JSON.stringify(expectedOfficialHosts)) {
  fail('The MVP-02 official product-page allowlist changed.')
}

const hpoiGateStart = configText.indexOf('export function liveGate(')
const officialGateStart = configText.indexOf('export function officialLiveGate(')
const hpoiGateText = configText.slice(hpoiGateStart, officialGateStart)
if (
  hpoiGateStart < 0 ||
  officialGateStart < 0 ||
  !hpoiGateText.includes('allowed: false') ||
  !hpoiGateText.includes('permanently disabled')
) {
  fail('The Hpoi live gate must remain permanently closed after the source block.')
}
if (!/^OFFICIAL_SOURCE_LIVE_FETCH_ENABLED=false$/m.test(envExampleText)) {
  fail('Official-source live fetch must remain disabled in .env.example.')
}
if (
  !/^\s*HPOI_LIVE_FETCH_ENABLED:\s*"false"$/m.test(workflowText) ||
  !/^\s*OFFICIAL_SOURCE_LIVE_FETCH_ENABLED:\s*"false"$/m.test(workflowText)
) {
  fail('Offline CI must explicitly disable both Hpoi and official-source live fetch.')
}

const tracked = trackedFiles()
const forbiddenTracked = tracked.filter((name) =>
  /(^|\/)(?:\.local|node_modules|test-results|playwright-report|\.next|dist|coverage)(\/|$)|\.(?:env|sqlite3?|db|dump|bak|png|jpe?g|gif|webp|avif|mp4|webm|zip|tar|gz)$/i.test(name),
)
if (forbiddenTracked.length) {
  fail(`Runtime, generated, database, media, or binary files are tracked: ${forbiddenTracked.join(', ')}`)
}

const formalFiles = tracked.filter((name) => name.startsWith('apps/web/'))
for (const name of formalFiles) {
  const text = readFileSync(path.join(repositoryRoot, name), 'utf8')
  if (/personal-gallery-mvp|\.local\/personal-gallery/i.test(text)) {
    fail(`The formal application references the disposable MVP tool: ${name}`)
  }
}

const sourceFiles = walk(toolRoot).filter((name) => /\.(?:js|mjs|ts|json|html|css|md)$/i.test(name))
for (const name of sourceFiles) {
  const relative = path.relative(repositoryRoot, name).replaceAll('\\', '/')
  const text = readFileSync(name, 'utf8')
  if (/from\s+['"][^'"]*(?:apps\/web|research\/|spikes\/)/i.test(text)) {
    fail(`The MVP imports a formal, research, or spike runtime dependency: ${relative}`)
  }
  if (/(?:FIRECRAWL_API_KEY|Authorization|Cookie)\s*[=:]\s*['"][^'"\s]{8,}/i.test(text)) {
    fail(`A credential-like literal appears in ${relative}`)
  }
  if (/\.(?:crawl|batchScrape|agent|browser|crawlUrl)\s*\(/.test(text)) {
    fail(`A forbidden Firecrawl mode appears in ${relative}`)
  }
}

const fixtureRoot = path.join(toolRoot, 'tests', 'fixtures')
for (const name of walk(fixtureRoot)) {
  const size = statSync(name).size
  if (size > 64 * 1024) fail(`Synthetic fixture exceeds 64 KiB: ${name}`)
  if (/\.html?$/i.test(name)) {
    const text = readFileSync(name, 'utf8')
    if (!/synthetic/i.test(text)) fail(`HTML fixture lacks an explicit synthetic marker: ${name}`)
  }
}

console.log(
  JSON.stringify(
    {
      status: 'pass',
      checks: {
        exactPins: true,
        independentLockfile: true,
        formalImportBoundary: true,
        noForbiddenFirecrawlModes: true,
        officialSearchV2WebOnly: true,
        officialSearchExcludesHpoi: true,
        officialFirecrawlMethods: ['search', 'scrape'],
        officialAllowlistPinned: true,
        multilingualQueries: expectedOfficialQueries.length,
        hpoiLiveFrozen: true,
        officialLiveDefaultOff: true,
        ciLiveGatesOff: true,
        noTrackedRuntimeOrMedia: true,
        syntheticFixtureSize: true,
      },
    },
    null,
    2,
  ),
)
