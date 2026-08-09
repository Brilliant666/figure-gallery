import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  DEFAULT_CHESHIRE_OFFICIAL_SEED_URLS,
  DEFAULT_RUNTIME_ROOT,
  liveGate,
  officialLiveGate,
  REPOSITORY_ROOT,
  TOOL_ROOT,
  validateFirecrawlBaseUrl,
  validateRuntimeRoot,
} from '../src/config.js'

test('Hpoi gate is permanently closed while official live access requires all local prerequisites', () => {
  const hpoi = liveGate({
    liveFetchEnabled: true,
    writtenPermissionConfirmed: true,
    firecrawlApiKey: 'synthetic',
  }, { interactiveConfirmation: true })
  assert.equal(hpoi.allowed, false)
  assert.match(hpoi.notice, /disabled/i)

  const closedOfficial = officialLiveGate(
    { officialLiveFetchEnabled: false, firecrawlApiKey: null },
    { interactiveConfirmation: false },
  )
  assert.equal(closedOfficial.allowed, false)
  assert.deepEqual(closedOfficial.missing, [
    'OFFICIAL_SOURCE_LIVE_FETCH_ENABLED=true',
    'interactive official-source confirmation',
    'FIRECRAWL_API_KEY',
  ])

  const openOfficial = officialLiveGate(
    { officialLiveFetchEnabled: true, firecrawlApiKey: 'synthetic' },
    { interactiveConfirmation: true },
  )
  assert.equal(openOfficial.allowed, true)
})

test('reviewed Cheshire fallback seeds stay limited to verified manufacturer and seed-only distributor pages', () => {
  assert.deepEqual(DEFAULT_CHESHIRE_OFFICIAL_SEED_URLS, [
    'https://www.goodsmile.com/en/product/36232/Cheshire%2BSummery%2BDate%2B',
    'https://www.goodsmile.com/en/product/36234/Cheshire%2BCait%2BSith%2BCrooner',
    'https://www.amiami.jp/top/detail/detail?gcode=FIGURE-188750',
    'https://www.amiami.jp/top/detail/detail?gcode=FIGURE-181336',
    'https://www.amiami.jp/top/detail/detail?gcode=FIGURE-158150',
  ])
})

test('Firecrawl base URL is pinned to the official HTTPS Cloud origin', () => {
  assert.equal(validateFirecrawlBaseUrl('https://api.firecrawl.dev'), 'https://api.firecrawl.dev')
  assert.equal(validateFirecrawlBaseUrl('https://api.firecrawl.dev/'), 'https://api.firecrawl.dev')
  for (const unsafe of [
    'http://api.firecrawl.dev',
    'https://firecrawl.dev',
    'https://api.firecrawl.dev.evil.example',
    'https://api.firecrawl.dev/v2',
    'https://api.firecrawl.dev?redirect=evil',
    'https://user:secret@api.firecrawl.dev',
  ]) {
    assert.throws(() => validateFirecrawlBaseUrl(unsafe), /must be exactly/)
  }
})

test('runtime root accepts only the dedicated subtree when it is inside the repository', () => {
  assert.equal(validateRuntimeRoot(DEFAULT_RUNTIME_ROOT), path.resolve(DEFAULT_RUNTIME_ROOT))
  assert.equal(
    validateRuntimeRoot(path.join(DEFAULT_RUNTIME_ROOT, 'profile-a')),
    path.resolve(DEFAULT_RUNTIME_ROOT, 'profile-a'),
  )
  assert.throws(() => validateRuntimeRoot(REPOSITORY_ROOT), /Unsafe PERSONAL_GALLERY_ROOT/)
  assert.throws(() => validateRuntimeRoot(TOOL_ROOT), /must stay under/)
  assert.throws(() => validateRuntimeRoot(path.join(REPOSITORY_ROOT, '.local')), /must stay under/)
  assert.throws(() => validateRuntimeRoot(path.parse(REPOSITORY_ROOT).root), /Unsafe PERSONAL_GALLERY_ROOT/)
})

test('runtime root refuses every ancestor that could recursively contain the repository', () => {
  let candidate = path.dirname(REPOSITORY_ROOT)
  while (candidate !== path.parse(candidate).root) {
    assert.throws(() => validateRuntimeRoot(candidate), /Unsafe PERSONAL_GALLERY_ROOT/)
    candidate = path.dirname(candidate)
  }
})

test('runtime root may be an isolated directory outside the repository', () => {
  const external = path.join(path.dirname(REPOSITORY_ROOT), 'figure-gallery-personal-runtime')
  assert.equal(validateRuntimeRoot(external), path.resolve(external))
})
