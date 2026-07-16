import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  assertRuntimeMarker,
  cleanupConfirmation,
  ensureRuntimeMarker,
} from '../../src/storage/runtime-root.js'

test('runtime marker and cleanup confirmation are bound to the exact absolute target', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-marker-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const first = path.join(parent, 'first')
  const second = path.join(parent, 'second')

  await ensureRuntimeMarker(first)
  await assertRuntimeMarker(first)
  await assert.rejects(() => assertRuntimeMarker(second), /valid target-bound runtime marker missing/)
  assert.notEqual(cleanupConfirmation(first), cleanupConfirmation(second))
  assert.match(cleanupConfirmation(first), /^DELETE-PERSONAL-GALLERY-[a-f0-9]{12}$/)
})

test('a copied or edited runtime marker cannot authorize another target', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-marker-mismatch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const marker = await ensureRuntimeMarker(root)
  marker.root = path.join(root, 'elsewhere')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path.join(root, '.personal-gallery-runtime.json'), `${JSON.stringify(marker)}\n`, 'utf8')
  await assert.rejects(() => assertRuntimeMarker(root), /valid target-bound runtime marker missing/)
})
