import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(toolRoot, '..', '..')

function fail(message) {
  throw new Error(message)
}

function acceptanceDigest(value) {
  const canonical = {
    status: value.status,
    browser: value.browser,
    gallery: value.gallery,
    network: value.network,
    responsive: value.responsive,
    interactions: value.interactions,
    artifacts: value.artifacts,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
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
if (packageJson.scripts?.['validate:chrome:real'] !== 'node scripts/validate-real-system-chrome.mjs') {
  fail('The local-only system Chrome acceptance command is missing or changed.')
}
if (packageJson.scripts?.['check:dependencies'] !== 'node scripts/check-installed-dependencies.mjs') {
  fail('The platform-aware dependency and Sharp runtime check is missing or changed.')
}

const lock = JSON.parse(readFileSync(path.join(toolRoot, 'package-lock.json'), 'utf8'))
if (lock.lockfileVersion !== 3 || lock.packages?.['']?.name !== packageJson.name) {
  fail('The independent npm lockfile is missing or invalid.')
}
if (lock.packages?.['node_modules/undici']?.version !== '7.29.0') {
  fail('The MVP lockfile must resolve undici to the audited 7.29.0 patch.')
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
const realChromeRunnerText = readFileSync(
  path.join(toolRoot, 'scripts', 'validate-real-system-chrome.mjs'),
  'utf8',
)
const mvp02Evidence = JSON.parse(readFileSync(
  path.join(repositoryRoot, 'research', 'evidence', 'mvp02', 'personal-gallery-results.json'),
  'utf8',
))
const mvp03aEvidence = JSON.parse(readFileSync(
  path.join(repositoryRoot, 'research', 'evidence', 'mvp03a', 'reference-index-results.json'),
  'utf8',
))
const mvp03aChromeRunnerText = readFileSync(
  path.join(toolRoot, 'scripts', 'validate-mvp03a-system-chrome.mjs'),
  'utf8',
)

if (
  !realChromeRunnerText.includes('chromium.launchPersistentContext(') ||
  !realChromeRunnerText.includes('C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe') ||
  !realChromeRunnerText.includes("mkdtemp(path.join(os.tmpdir(), 'figure-gallery-mvp02-chrome-'))") ||
  !realChromeRunnerText.includes('context.routeWebSocket(') ||
  !realChromeRunnerText.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1') ||
  !realChromeRunnerText.includes("code: 'runtime_data_missing'") ||
  !realChromeRunnerText.includes("code: 'runtime_data_corrupt'")
) {
  fail('MVP02-11 system Chrome, runtime-state, profile, or network guard logic is incomplete.')
}
if (
  /--load-extension|--disable-extensions-except|User Data|Profile \d+/i.test(realChromeRunnerText) ||
  /screenshot\s*:|recordVideo\s*:|trace\s*:/i.test(realChromeRunnerText) ||
  /chromium\.launch\s*\(/.test(realChromeRunnerText)
) {
  fail('MVP02-11 must not use an extension, user profile, screenshot, video, or trace.')
}
const browserEvidence = mvp02Evidence.realBrowserValidation || {}
const evidenceGates = Array.isArray(mvp02Evidence.gates) ? mvp02Evidence.gates : []
const expectedGateIds = Array.from({ length: 12 }, (_, index) => `MVP02-${String(index + 1).padStart(2, '0')}`)
const requiredInteractions = [
  'open',
  'fit',
  'actualSize',
  'zoomIn',
  'zoomOut',
  'rightAndLeft',
  'crossProductNavigation',
  'firstAndLastBoundaries',
  'escapeClose',
  'excludeRestore',
  'preferredCoverPersisted',
  'manualNotePersisted',
  'originalBytesRestored',
]
const expectedResponsive = [[1280, 4], [900, 3], [600, 2]]
if (
  mvp02Evidence.overallStatus !== 'pass' ||
  browserEvidence.status !== 'pass' ||
  evidenceGates.length !== 12 ||
  JSON.stringify(evidenceGates.map((gate) => gate.id)) !== JSON.stringify(expectedGateIds) ||
  evidenceGates.some((gate) => gate.status !== 'pass') ||
  browserEvidence.runner !== 'tools/personal-gallery-mvp/scripts/validate-real-system-chrome.mjs' ||
  browserEvidence.browser?.product !== 'Google Chrome' ||
  !systemChromeCandidatesForEvidence().includes(browserEvidence.browser?.executable) ||
  !/^\d+(?:\.\d+){3}$/.test(browserEvidence.browser?.version || '') ||
  typeof browserEvidence.browser?.headed !== 'boolean' ||
  browserEvidence.browser?.systemChrome !== true ||
  browserEvidence.browser?.bundledChromiumUsed !== false ||
  browserEvidence.browser?.temporaryCleanProfile !== true ||
  browserEvidence.browser?.temporaryProfileDeleted !== true ||
  browserEvidence.browser?.extensionsLoaded !== 0 ||
  browserEvidence.browser?.userProfileRead !== false ||
  Number(browserEvidence.gallery?.productCards) !== 7 ||
  Number(browserEvidence.gallery?.localObjects) < 56 ||
  Number(browserEvidence.gallery?.localImages) < 56 ||
  Number(browserEvidence.gallery?.mediaHttp?.checked) < 56 ||
  Number(browserEvidence.gallery?.mediaHttp?.http200) < 56 ||
  Number(browserEvidence.gallery?.mediaHttp?.failures) !== 0 ||
  browserEvidence.gallery?.manufacturers?.alter !== true ||
  browserEvidence.gallery?.manufacturers?.goodSmile !== true ||
  browserEvidence.gallery?.manufacturers?.apex !== true ||
  browserEvidence.gallery?.manufacturers?.amiami !== true ||
  browserEvidence.gallery?.manufacturers?.separateCards !== true ||
  !Array.isArray(browserEvidence.responsive) ||
  browserEvidence.responsive.length !== 3 ||
  browserEvidence.responsive.some((item, index) =>
    item?.viewport?.width !== expectedResponsive[index][0] ||
    item?.viewport?.height !== 900 ||
    item?.expected !== expectedResponsive[index][1] ||
    item?.actual !== expectedResponsive[index][1] ||
    item?.status !== 'pass'
  ) ||
  requiredInteractions.some((name) => browserEvidence.interactions?.[name] !== true) ||
  Number(browserEvidence.network?.externalRequests) !== 0 ||
  Number(browserEvidence.network?.externalHttpRequests) !== 0 ||
  Number(browserEvidence.network?.externalWebSocketRequests) !== 0 ||
  Number(browserEvidence.network?.hpoiRequests) !== 0 ||
  Number(browserEvidence.network?.firecrawlRequests) !== 0 ||
  Number(browserEvidence.network?.officialSourceRequests) !== 0 ||
  Number(browserEvidence.network?.otherExternalRequests) !== 0 ||
  Number(browserEvidence.network?.loopbackRequests) <= 0 ||
  browserEvidence.network?.applicationNavigationGuarded !== true ||
  Number(browserEvidence.artifacts?.screenshots) !== 0 ||
  Number(browserEvidence.artifacts?.videos) !== 0 ||
  Number(browserEvidence.artifacts?.traces) !== 0 ||
  browserEvidence.resultDigest !== acceptanceDigest(browserEvidence) ||
  Number(mvp02Evidence.taskNetworkTotals?.hpoiRequests) !== 0 ||
  Number(mvp02Evidence.realRuns?.finalPinnedTransportIdempotencyRun?.productsNew) !== 0 ||
  Number(mvp02Evidence.realRuns?.finalPinnedTransportIdempotencyRun?.newSha256Objects) !== 0 ||
  Number(mvp02Evidence.coverageExpansion?.finalPair?.secondRun?.productsNew) !== 0 ||
  Number(mvp02Evidence.coverageExpansion?.finalPair?.secondRun?.productsUnchanged) !== 7 ||
  Number(mvp02Evidence.coverageExpansion?.finalPair?.secondRun?.productsChanged) !== 0 ||
  Number(mvp02Evidence.coverageExpansion?.finalPair?.secondRun?.newSha256Objects) !== 0 ||
  Number(mvp02Evidence.coverageExpansion?.finalPair?.secondRun?.imageFailures) !== 3 ||
  Number(mvp02Evidence.realGallery?.officialProductCards) !== 7 ||
  Number(mvp02Evidence.realGallery?.localImages) < 56 ||
  Number(mvp02Evidence.realGallery?.knownCurrentFailures?.count) !== 3
) {
  fail('The committed MVP-02 result does not satisfy the corrected MVP02-11 and all-pass gate contract.')
}

function systemChromeCandidatesForEvidence() {
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
}

const referenceGates = Array.isArray(mvp03aEvidence.gates) ? mvp03aEvidence.gates : []
const expectedReferenceGates = Array.from(
  { length: 15 },
  (_, index) => `REF-${String(index + 1).padStart(2, '0')}`,
)
if (
  mvp03aEvidence.status !== 'MVP-03A ready for personal use review' ||
  JSON.stringify(referenceGates.map((gate) => gate.id)) !== JSON.stringify(expectedReferenceGates) ||
  referenceGates.some((gate) => gate.status !== 'pass') ||
  Number(mvp03aEvidence.realRuntime?.products) !== 7 ||
  Number(mvp03aEvidence.realRuntime?.images) !== 62 ||
  Number(mvp03aEvidence.realRuntime?.indexCovers) !== 7 ||
  Number(mvp03aEvidence.realRuntime?.productsWithoutImages) !== 0 ||
  Number(mvp03aEvidence.realRuntime?.classificationCounts?.unknown) !== 0 ||
  Number(mvp03aEvidence.realRuntime?.apex?.localImages) !== 1 ||
  Number(mvp03aEvidence.realRuntime?.alter?.localImages) !== 6 ||
  Number(mvp03aEvidence.systemChrome?.index?.imageRequests) !== 7 ||
  mvp03aEvidence.systemChrome?.interactions?.unknownOptionAbsent !== 'pass' ||
  Number(mvp03aEvidence.systemChrome?.network?.externalRequests) !== 0 ||
  mvp03aEvidence.realRuntime?.runtimeTrackedByGit !== false ||
  mvp03aEvidence.collection?.cheshireRecrawled !== false ||
  mvp03aEvidence.collection?.targetedOfficialImageRepair !== true ||
  Number(mvp03aEvidence.collection?.uniqueObjectsAdded) !== 6 ||
  mvp03aEvidence.collection?.hpoiRequests !== 0 ||
  mvp03aEvidence.collection?.firecrawlRequests !== 0
) {
  fail('The committed MVP-03A evidence does not satisfy REF-01 through REF-15.')
}
if (
  !mvp03aChromeRunnerText.includes('figure-gallery-mvp03a-chrome-') ||
  !mvp03aChromeRunnerText.includes('--disable-extensions') ||
  !mvp03aChromeRunnerText.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1') ||
  /screenshot\s*:|recordVideo\s*:|trace\s*:/i.test(mvp03aChromeRunnerText)
) {
  fail('The MVP-03A system Chrome acceptance guard is incomplete.')
}

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

const expectedManufacturerHosts = [
  'goodsmile.com',
  'www.goodsmile.com',
  'goodsmilearts.com',
  'www.goodsmilearts.com',
  'alter-web.jp',
  'www.alter-web.jp',
  'apex-toys.com',
  'www.apex-toys.com',
]
const expectedDistributorHosts = [
  'amiami.jp',
  'www.amiami.jp',
]
const manufacturerHostsBlock = officialUrlsText.match(/const OFFICIAL_MANUFACTURER_HOSTS = new Set\(\[([\s\S]*?)\]\)/)
const distributorHostsBlock = officialUrlsText.match(/const OFFICIAL_DISTRIBUTOR_HOSTS = new Set\(\[([\s\S]*?)\]\)/)
const actualManufacturerHosts = manufacturerHostsBlock
  ? [...manufacturerHostsBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  : []
const actualDistributorHosts = distributorHostsBlock
  ? [...distributorHostsBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  : []
if (
  JSON.stringify(actualManufacturerHosts) !== JSON.stringify(expectedManufacturerHosts) ||
  JSON.stringify(actualDistributorHosts) !== JSON.stringify(expectedDistributorHosts)
) {
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
        systemChromeAcceptanceContract: true,
        mvp02AllTwelveGatesPass: true,
        mvp03aAllFifteenGatesPass: true,
        mvp03aSystemChromeAcceptanceContract: true,
        noTrackedRuntimeOrMedia: true,
        syntheticFixtureSize: true,
      },
    },
    null,
    2,
  ),
)
