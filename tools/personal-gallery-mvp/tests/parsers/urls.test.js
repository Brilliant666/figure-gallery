import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractCharacterId,
  extractProductId,
  isAllowedHpoiPageUrl,
  normalizePageUrl,
  sanitizeUrlForRecord,
  stableUrlHash,
} from '../../src/parsers/urls.js'

test('stable URL rules accept only Hpoi page hosts and known ID paths', () => {
  assert.equal(extractCharacterId('https://www.hpoi.net/charactar/999999901'), '999999901')
  assert.equal(extractProductId('https://hpoi.net/move/hobby/999999912/'), '999999912')
  assert.equal(extractProductId('https://www.hpoi.net/hobby/not-a-number'), null)
  assert.equal(isAllowedHpoiPageUrl('https://rfx.hpoi.net/hobby/1'), false)
  assert.equal(isAllowedHpoiPageUrl('http://www.hpoi.net/hobby/1'), false)
  assert.equal(isAllowedHpoiPageUrl('https://user:secret@www.hpoi.net/hobby/1'), false)
  assert.equal(normalizePageUrl('https://user:secret@www.hpoi.net/hobby/1'), null)
  assert.equal(normalizePageUrl('https://www.hpoi.net/hobby/1?token=secret'), null)
  assert.equal(extractProductId('https://www.hpoi.net/hobby/1?session=secret'), null)
  assert.equal(
    sanitizeUrlForRecord('https://user:secret@example.test/image.png?token=secret&size=large'),
    'https://example.test/image.png?size=large',
  )
})

test('URL normalization removes fragments and tracking keys without inventing paths', () => {
  assert.equal(
    normalizePageUrl('http://hpoi.net/hobby/999999911/?utm_source=x&b=2&a=1#gallery'),
    'https://www.hpoi.net/hobby/999999911?a=1&b=2',
  )
  assert.equal(normalizePageUrl('/hobby/999999911', 'https://www.hpoi.net/charactar/999999901'), 'https://www.hpoi.net/hobby/999999911')
})

test('fallback URL hashing is deterministic only for allowlisted page URLs', () => {
  assert.equal(stableUrlHash('https://hpoi.net/hobby/999999911'), stableUrlHash('https://www.hpoi.net/hobby/999999911/'))
  assert.throws(() => stableUrlHash('https://example.test/hobby/1'), /Cannot hash/)
})
