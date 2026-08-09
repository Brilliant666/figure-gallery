import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCharacterDiscoveryQueries,
  conflictingCharacterMatch,
  matchesCharacterText,
  matchesCharacterWork,
  resolveBuiltinCharacter,
  validateCharacterConfig,
} from '../../src/characters/registry.js'

test('Rem configuration produces a deterministic bounded matrix covering every configured dimension', () => {
  const rem = resolveBuiltinCharacter('蕾姆')
  const first = buildCharacterDiscoveryQueries(rem)
  const second = buildCharacterDiscoveryQueries(resolveBuiltinCharacter('レム'))
  assert.equal(first.length, 30)
  assert.deepEqual(second, first)
  assert.equal(new Set(first).size, 30)
  for (const alias of rem.aliases) assert.ok(first.some((query) => query.includes(alias)), `missing alias ${alias}`)
  for (const work of rem.workNames) assert.ok(first.some((query) => query.includes(work)), `missing work ${work}`)
  for (const term of rem.productTerms) assert.ok(first.some((query) => query.includes(term)), `missing term ${term}`)
})

test('Rem matching uses word boundaries, work evidence, and explicit Ram conflicts', () => {
  const rem = resolveBuiltinCharacter('Rem')
  assert.equal(matchesCharacterText('Rem 1/7 scale figure', rem), true)
  assert.equal(matchesCharacterText('remote backup software', rem), false)
  assert.equal(matchesCharacterText('premier tourist attraction', rem), false)
  assert.equal(matchesCharacterWork('Re:ZERO -Starting Life in Another World-', rem), true)
  assert.equal(matchesCharacterWork('an unrelated fantasy work', rem), false)
  assert.equal(conflictingCharacterMatch('Ram 1/7 scale figure', rem), 'Ram')
})

test('reviewed seeds are character-scoped and reject cross-character ownership', () => {
  const rem = resolveBuiltinCharacter('蕾姆')
  const scoped = validateCharacterConfig({
    ...rem,
    reviewedSeeds: [{
      url: 'https://www.goodsmile.com/en/product/29001/rem',
      sourceType: 'official_manufacturer',
      reviewReason: 'Synthetic ownership check.',
      reviewedAt: '2032-01-02',
    }],
  })
  assert.equal(scoped.reviewedSeeds[0].characterId, rem.characterId)
  assert.throws(() => validateCharacterConfig({
    ...rem,
    reviewedSeeds: [{
      characterId: 'azur-lane:cheshire',
      url: 'https://www.goodsmile.com/en/product/29001/rem',
      sourceType: 'official_manufacturer',
      reviewReason: 'Wrong owner.',
      reviewedAt: '2032-01-02',
    }],
  }), /belong to its character/u)
})
