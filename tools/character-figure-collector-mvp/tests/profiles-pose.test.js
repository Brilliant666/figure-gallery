import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveProfile, matchesProfileRecord } from '../src/profiles.js'
import { looksLikeFigure, poseExclusionReason } from '../src/pose-eligibility.js'

test('profiles resolve aliases and discriminate series', () => {
  const rem = resolveProfile('レム')
  const cheshire = resolveProfile('柴郡')
  assert.equal(rem.slug, 'rem')
  assert.equal(cheshire.slug, 'cheshire')
  assert.equal(matchesProfileRecord({ title: 'Cheshire Summery Date Figure', series: 'Azur Lane' }, cheshire), true)
  assert.equal(matchesProfileRecord({ title: 'Cheshire Cat Figure', series: 'Alice in Wonderland' }, cheshire), false)
  assert.equal(matchesProfileRecord({ title: 'Little Cheshire Figure', series: 'Azur Lane' }, cheshire), true)
  assert.equal(matchesProfileRecord({ title: 'Cheshire Figure', series: 'Re:ZERO' }, cheshire), false)
  assert.equal(matchesProfileRecord({ title: 'Ram Figure', series: 'Re:ZERO' }, rem), false)
})

test('shared pose eligibility keeps normal scale and prize but excludes unsupported forms', () => {
  const cheshire = resolveProfile('cheshire')
  for (const character of ['Rem', 'Cheshire']) {
    assert.equal(looksLikeFigure({ title: `${character} 1/7 Scale Figure`, category: 'Scale Figure' }), true)
    assert.equal(poseExclusionReason({ title: `${character} Prize Figure`, category: 'Prize' }), null)
    assert.equal(poseExclusionReason({ title: `${character} Nendoroid`, category: 'Figure' }), 'Nendoroid')
    assert.equal(poseExclusionReason({ title: `${character} ArtScale Bust`, category: 'Bust' }), 'Bust')
    assert.equal(poseExclusionReason({ title: `${character} Figuarts mini`, category: 'Figure' }), 'Action/Figma')
    assert.equal(poseExclusionReason({ title: `${character} Acrylic Stand`, category: 'Merch' }), 'Merch')
  }
  assert.deepEqual(cheshire.poseExcludedAliases, ['Little Cheshire', 'リトルチェシャー', '小柴郡'])
  assert.equal(poseExclusionReason({ title: 'Little Cheshire Figure', category: 'Figure', profilePoseExclusion: 'Deformed/Q' }), 'Deformed/Q')
  assert.equal(poseExclusionReason({ title: 'Cheshire Soft Vinyl Figure', category: 'Soft Vinyl' }), null)
})

test('shared description evidence excludes deformed and pint-sized product lines', () => {
  assert.equal(poseExclusionReason({ title: 'Summer Swimsuit Figure', category: 'General', description: 'A deformed-style chibi figure set', tags: [] }), 'Deformed/Q')
  assert.equal(poseExclusionReason({ title: 'Happy Shake Figure', category: 'General', description: '', tags: [] }), 'Deformed/Q')
  assert.equal(poseExclusionReason({ title: 'Static Figure', category: 'General', description: 'This pint-sized charm is 10 cm tall', tags: [] }), 'Deformed/Q')
})
