import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  acquireCollectorLock,
  CollectorLockedError,
} from '../../src/storage/collector-lock.js'

test('one runtime root grants only one collection lock across independent owners', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-collector-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const first = await acquireCollectorLock(root, {
    pid: 101,
    tokenFactory: () => 'first-owner',
  })
  await assert.rejects(
    acquireCollectorLock(root, {
      pid: 202,
      tokenFactory: () => 'second-owner',
    }),
    (error) => error instanceof CollectorLockedError && error.code === 'COLLECTION_ALREADY_ACTIVE',
  )

  assert.equal(await first.release(), true)
  const second = await acquireCollectorLock(root, {
    pid: 202,
    tokenFactory: () => 'second-owner',
  })
  assert.equal(await second.release(), true)
})

test('an apparent dead owner remains fail-closed until its lock is explicitly released', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-stale-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const deadOwner = await acquireCollectorLock(root, {
    pid: 303,
    tokenFactory: () => 'dead-owner',
  })
  await assert.rejects(
    acquireCollectorLock(root, {
      pid: 404,
      tokenFactory: () => 'replacement-owner',
    }),
    { code: 'COLLECTION_ALREADY_ACTIVE' },
  )
  assert.equal(await deadOwner.release(), true)
  const replacement = await acquireCollectorLock(root, {
    pid: 404,
    tokenFactory: () => 'replacement-owner',
  })
  assert.equal(await replacement.release(), true)
})
