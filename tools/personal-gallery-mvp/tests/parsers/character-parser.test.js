import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  parseCharacterCandidates,
  parseCharacterPage,
  resolveCharacterMatch,
} from '../../src/parsers/character-parser.js'

const fixture = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

test('character discovery extracts stable IDs and requires disambiguation for same-name roles', async () => {
  const rawHtml = await fixture('character-search.synthetic.html')
  const candidates = parseCharacterCandidates({ query: '柴郡', rawHtml, sourceUrl: 'https://www.hpoi.net/search' })

  assert.equal(candidates.length, 2)
  assert.deepEqual(candidates.map((candidate) => candidate.characterId), ['999999901', '999999902'])
  assert.deepEqual(candidates.map((candidate) => candidate.workName), ['合成作品甲', '合成作品乙'])
  assert.ok(candidates.every((candidate) => candidate.confidence === 'high'))
  assert.equal(resolveCharacterMatch(candidates).status, 'disambiguation')
})

test('a single exact result is eligible for deterministic direct matching', () => {
  const candidates = parseCharacterCandidates({
    query: '柴郡',
    searchResults: [{ title: '柴郡', url: 'https://www.hpoi.net/charactar/999999901' }],
  })
  const resolution = resolveCharacterMatch(candidates)
  assert.equal(resolution.status, 'matched')
  assert.equal(resolution.match.characterId, '999999901')
})

test('character page follows only explicit next links and deduplicates product URLs', async () => {
  const rawHtml = await fixture('character-page-1.synthetic.html')
  const result = parseCharacterPage({
    rawHtml,
    url: 'https://www.hpoi.net/charactar/999999901',
    links: ['https://www.hpoi.net/hobby/999999911', 'https://outside.example/hobby/1'],
  })

  assert.equal(result.characterId, '999999901')
  assert.equal(result.displayName, '柴郡')
  assert.equal(result.workName, '合成作品甲')
  assert.deepEqual(result.productIds, ['999999911', '999999912'])
  assert.equal(result.nextPageUrl, 'https://www.hpoi.net/charactar/999999901?page=2')
  assert.deepEqual(result.parserWarnings, [])
})

test('last character page does not invent a page-number URL', async () => {
  const rawHtml = await fixture('character-page-2.synthetic.html')
  const result = parseCharacterPage({ rawHtml, url: 'https://www.hpoi.net/charactar/999999901?page=2' })
  assert.equal(result.nextPageUrl, null)
  assert.deepEqual(result.productIds, ['999999913'])
})

test('non-Hpoi character pages are rejected', () => {
  assert.throws(
    () => parseCharacterPage({ rawHtml: '<h1>柴郡</h1>', url: 'https://example.test/charactar/1' }),
    /not an allowed Hpoi character URL/,
  )
})
