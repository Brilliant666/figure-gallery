import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveBuiltinCharacter } from '../../src/characters/registry.js'
import { createDiscoveryCandidate } from '../../src/discovery/hpoi-index.js'
import { DiscoveryStore } from '../../src/storage/discovery-store.js'

test('candidate storage is character-scoped, idempotent, and does not regress collected status', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hpoi-index-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const character = resolveBuiltinCharacter('cheshire')
  const store = await new DiscoveryStore(root, { characterConfig: character }).initialize()
  const candidate = createDiscoveryCandidate({
    url: 'https://www.hpoi.net/hobby/9904001',
    title: 'Azur Lane Cheshire Synthetic 1/7 scale figure',
    description: '碧蓝航线 柴郡 比例人形 synthetic',
  }, character)
  candidate.scopeStatus = candidate.status
  assert.equal((await store.upsertCandidates([candidate])).created, 1)
  assert.equal((await store.upsertCandidates([candidate])).created, 0)
  await store.updateCandidate(candidate.candidateId, (current) => ({ ...current, status: 'collected', matchedProductId: 'product-1' }))
  const replay = await store.upsertCandidates([{ ...candidate, status: 'in_scope' }])
  assert.equal(replay.candidates[0].status, 'collected')
  assert.equal(replay.candidates[0].matchedProductId, 'product-1')
})
