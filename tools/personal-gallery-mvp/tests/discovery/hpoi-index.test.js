import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolveBuiltinCharacter } from '../../src/characters/registry.js'
import {
  buildHpoiIndexQueries,
  classifyIndexedCandidate,
  createDiscoveryCandidate,
  inferVariantPhrase,
  normalizeIndexedHpoiUrl,
} from '../../src/discovery/hpoi-index.js'
import {
  buildOfficialResolutionQueries,
  matchCandidateToProducts,
  rankOfficialResolution,
} from '../../src/discovery/matching.js'

const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'hpoi-index-results.synthetic.json')
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
const cheshire = resolveBuiltinCharacter('cheshire')
const rem = resolveBuiltinCharacter('rem')

test('deterministic query matrices are bounded, multilingual, and explicitly site-scoped', () => {
  const cheshireQueries = buildHpoiIndexQueries(cheshire)
  const remQueries = buildHpoiIndexQueries(rem)
  for (const queries of [cheshireQueries, remQueries]) {
    assert.ok(queries.length > 0 && queries.length <= 30)
    assert.equal(new Set(queries).size, queries.length)
    assert.ok(queries.every((query) => query.startsWith('site:hpoi.net ')))
  }
  for (const alias of cheshire.aliases) assert.ok(cheshireQueries.some((query) => query.includes(`"${alias}"`)))
  for (const alias of rem.aliases) assert.ok(remQueries.some((query) => query.includes(`"${alias}"`)))
})

test('indexed URL handling stores only normalized Hpoi product URL text and never accepts navigation targets', () => {
  assert.equal(
    normalizeIndexedHpoiUrl('https://hpoi.net/hobby/9901001?utm_source=synthetic#x'),
    'https://www.hpoi.net/hobby/9901001',
  )
  assert.equal(normalizeIndexedHpoiUrl('https://www.hpoi.net/charactar/1'), null)
  assert.equal(normalizeIndexedHpoiUrl('https://www.hpoi.net/hobby/1?token=secret'), null)
  assert.equal(normalizeIndexedHpoiUrl('https://example.test/hobby/1'), null)
  assert.equal(normalizeIndexedHpoiUrl('http://www.hpoi.net/hobby/1'), null)
})

test('scope and character classification keeps uncertainty but rejects Little Cheshire, Ram, Nendoroid, and GK', () => {
  const entries = fixture.cheshire.map((entry) => createDiscoveryCandidate(entry, cheshire))
  assert.equal(entries[0].status, 'in_scope')
  assert.equal(entries[2].status, 'in_scope')
  assert.deepEqual(entries.slice(3).map((entry) => entry.status), ['out_of_scope', 'out_of_scope', 'out_of_scope'])
  assert.match(entries[3].statusReason, /^different_character_/)
  const remEntries = fixture.rem.map((entry) => createDiscoveryCandidate(entry, rem))
  assert.equal(remEntries[0].status, 'in_scope')
  assert.equal(remEntries[1].status, 'in_scope')
  assert.equal(remEntries[2].status, 'out_of_scope')
  assert.match(remEntries[2].statusReason, /Ram/)
  assert.equal(classifyIndexedCandidate({ titleHint: 'Rem collectible', snippetHint: '' }, rem).status, 'ambiguous')
})

test('existing matching uses title, manufacturer, scale, and official URL evidence without image similarity', () => {
  const candidate = createDiscoveryCandidate(fixture.cheshire[0], cheshire)
  const existing = [{
    id: 'synthetic-existing-product',
    title: 'Cheshire Synthetic Existing',
    manufacturer: 'Good Smile Company',
    scale: '1/7',
    sourceUrl: 'https://www.goodsmile.com/en/product/9901001/Synthetic',
  }]
  assert.equal(matchCandidateToProducts(candidate, existing).kind, 'exact_existing')
  assert.equal(matchCandidateToProducts(createDiscoveryCandidate(fixture.cheshire[2], cheshire), existing).kind, 'new_target')
  assert.equal(inferVariantPhrase('Azur Lane Cheshire Dating Summer Ver.', cheshire), 'dating summer')
  assert.equal(inferVariantPhrase('Re:从零开始的异世界生活蕾姆| Hpoi手办维基动漫模玩百科资料库', rem), null)
  assert.equal(matchCandidateToProducts({
    ...candidate,
    titleHint: 'Cheshire',
    variantHint: null,
    manufacturerHint: null,
    scaleHint: null,
  }, existing).kind, 'ambiguous')
  assert.equal(matchCandidateToProducts({
    ...candidate,
    resolutionEvidence: [{ officialProductId: 'GSC-9901001' }],
  }, [{ ...existing[0], officialProductId: 'gsc-9901001', title: 'A translated title' }]).kind, 'exact_existing')
})

test('official resolution queries are targeted and only reviewed official results can rank', () => {
  const candidate = createDiscoveryCandidate(fixture.cheshire[2], cheshire)
  const queries = buildOfficialResolutionQueries(candidate, cheshire)
  assert.ok(queries.length >= 2 && queries.length <= 3)
  assert.ok(queries.some((query) => /apex-toys\.com/iu.test(query)))
  const ranked = rankOfficialResolution(candidate, cheshire, fixture.officialResolution.map((entry) => ({
    ...entry,
    sourceUrl: entry.url,
    sourceDomain: new URL(entry.url).hostname,
  })))
  assert.equal(ranked[0].officialUrl, 'https://apex-toys.com/productinfo/9901002.html')
})
