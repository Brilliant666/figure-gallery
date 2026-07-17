import path from 'node:path'

import { atomicWriteJson, readJson } from './json-files.js'

export const HPOI_FROZEN_STATUS = Object.freeze({
  hpoiLiveStatus: 'blocked_by_source',
  stopReason: 'captcha',
  retryAllowed: false,
  blockedAt: '2026-07-16T18:13:03.887Z',
  consecutiveBlockedRuns: 3,
})

export const DEFAULT_SOURCE_STATUS = Object.freeze({
  schemaVersion: 1,
  hpoi: HPOI_FROZEN_STATUS,
})

export function sourceStatusPath(root) {
  return path.join(root, 'source-status.json')
}

export async function ensureSourceStatus(root) {
  const target = sourceStatusPath(root)
  const existing = await readJson(target, null)
  const expected = {
    schemaVersion: 1,
    ...(existing && typeof existing === 'object' ? existing : {}),
    hpoi: { ...HPOI_FROZEN_STATUS },
  }
  if (JSON.stringify(existing) !== JSON.stringify(expected)) {
    await atomicWriteJson(target, expected)
  }
  return expected
}

export async function readSourceStatus(root) {
  return ensureSourceStatus(root)
}
