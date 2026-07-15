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
        noTrackedRuntimeOrMedia: true,
        syntheticFixtureSize: true,
      },
    },
    null,
    2,
  ),
)
