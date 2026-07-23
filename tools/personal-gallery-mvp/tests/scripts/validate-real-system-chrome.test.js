import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  computeAcceptanceDigest,
  countGridColumns,
  isAllowedLoopbackRequest,
  isAllowedLoopbackWebSocket,
  runAcceptance,
  systemChromeCandidates,
} from '../../scripts/validate-real-system-chrome.mjs'

test('real Chrome network policy only permits the exact local gallery origin', () => {
  assert.equal(isAllowedLoopbackRequest('http://127.0.0.1:4317/gallery/characters/cheshire'), true)
  assert.equal(isAllowedLoopbackRequest('http://127.0.0.1:4317/media/abc'), true)
  assert.equal(isAllowedLoopbackRequest('https://127.0.0.1:4317/'), false)
  assert.equal(isAllowedLoopbackRequest('http://localhost:4317/'), false)
  assert.equal(isAllowedLoopbackRequest('http://127.0.0.1:4318/'), false)
  assert.equal(isAllowedLoopbackRequest('https://www.hpoi.net/'), false)
  assert.equal(isAllowedLoopbackRequest('https://www.goodsmile.com/'), false)
  assert.equal(isAllowedLoopbackWebSocket('ws://127.0.0.1:4317/status'), true)
  assert.equal(isAllowedLoopbackWebSocket('wss://127.0.0.1:4317/status'), false)
  assert.equal(isAllowedLoopbackWebSocket('ws://localhost:4317/status'), false)
  assert.equal(isAllowedLoopbackWebSocket('wss://www.hpoi.net/status'), false)
})

test('real Chrome validation pins the two supported Windows system locations', () => {
  assert.deepEqual(systemChromeCandidates('win32'), [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ])
  assert.deepEqual(systemChromeCandidates('linux'), [])
})

test('responsive column evidence counts computed grid tracks', () => {
  assert.equal(countGridColumns('280px 280px 280px 280px'), 4)
  assert.equal(countGridColumns('280px 280px 280px'), 3)
  assert.equal(countGridColumns('280px 280px'), 2)
  assert.equal(countGridColumns(''), 0)
})

test('real Chrome result digest binds every committed acceptance section', () => {
  const value = {
    status: 'pass',
    browser: { systemChrome: true },
    gallery: { localObjects: 19 },
    network: { externalRequests: 0 },
    responsive: [{ expected: 4, actual: 4 }],
    interactions: { lightbox: true },
    artifacts: { screenshots: 0 },
  }
  const digest = computeAcceptanceDigest(value)
  assert.match(digest, /^[a-f\d]{64}$/)
  assert.equal(computeAcceptanceDigest(structuredClone(value)), digest)
  value.network.externalRequests = 1
  assert.notEqual(computeAcceptanceDigest(value), digest)
})

test('real Chrome runner classifies missing and corrupt runtime data before launching a browser', async () => {
  const originalRoot = process.env.PERSONAL_GALLERY_ROOT
  const missing = path.join(os.tmpdir(), `figure-gallery-missing-${process.pid}-${Date.now()}`)
  const corrupt = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-corrupt-'))
  try {
    process.env.PERSONAL_GALLERY_ROOT = missing
    await assert.rejects(runAcceptance(), (error) => error?.code === 'runtime_data_missing')

    await mkdir(path.join(corrupt, 'runs', 'broken-run'), { recursive: true })
    await writeFile(path.join(corrupt, 'runs', 'broken-run', 'run.json'), '{invalid json', 'utf8')
    process.env.PERSONAL_GALLERY_ROOT = corrupt
    await assert.rejects(runAcceptance(), (error) => error?.code === 'runtime_data_corrupt')
  } finally {
    if (originalRoot === undefined) delete process.env.PERSONAL_GALLERY_ROOT
    else process.env.PERSONAL_GALLERY_ROOT = originalRoot
    await rm(corrupt, { recursive: true, force: true })
  }
})
