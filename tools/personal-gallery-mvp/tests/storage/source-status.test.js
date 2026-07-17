import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { ensureSourceStatus, HPOI_FROZEN_STATUS, readSourceStatus } from '../../src/storage/source-status.js'

test('Hpoi source status is frozen as blocked and cannot drift back to retryable', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-source-status-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const first = await ensureSourceStatus(root)
  const second = await readSourceStatus(root)
  assert.deepEqual(first.hpoi, HPOI_FROZEN_STATUS)
  assert.deepEqual(second, first)
  assert.equal(second.hpoi.hpoiLiveStatus, 'blocked_by_source')
  assert.equal(second.hpoi.stopReason, 'captcha')
  assert.equal(second.hpoi.retryAllowed, false)
  assert.equal(second.hpoi.consecutiveBlockedRuns, 3)
  assert.equal(second.hpoi.blockedAt, '2026-07-16T18:13:03.887Z')
})
