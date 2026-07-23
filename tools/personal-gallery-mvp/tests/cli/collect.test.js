import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const collectCli = path.join(toolRoot, 'src', 'cli', 'collect.js')

function blockedRun(args) {
  const output = execFileSync(process.execPath, [collectCli, ...args], {
    cwd: toolRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FIRECRAWL_API_KEY: '',
      HPOI_LIVE_FETCH_ENABLED: 'false',
      HPOI_WRITTEN_PERMISSION_CONFIRMED: 'false',
      OFFICIAL_SOURCE_LIVE_FETCH_ENABLED: 'false',
    },
  })
  return JSON.parse(output)
}

test('collect CLI accepts both the documented option and Windows npm positional forwarding without network', () => {
  for (const args of [['--query', '柴郡'], ['柴郡']]) {
    const result = blockedRun(args)
    assert.equal(result.status, 'environment_blocked')
    assert.equal(result.query, '柴郡')
    assert.equal(result.sourceMode, 'official_sources')
    assert.equal(result.hpoiStatus, 'blocked_by_source')
    assert.equal(result.hpoiRequests, 0)
    assert.equal(result.firecrawlSearchRequests, 0)
    assert.equal(result.firecrawlScrapeRequests, 0)
    assert.equal(result.firecrawlRequests, 0)
    assert.match(result.notice, /official/i)
  }
})
