import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeMultiCharacterRuntime } from '../../scripts/validate-mvp04-system-chrome.mjs'

function gallery({ products, images, manual = 0, classifications = {} }) {
  return {
    products: Array.from({ length: products }, (_unused, index) => ({
      manufacturer: `Factory ${index % 4}`,
      images: Array.from({ length: Math.floor(images / products) }, (_item, image) => ({ sha256: `${index}-${image}` })),
      coverImage: {},
      coverSelectionSource: index < manual ? 'manual_override' : 'official_primary',
    })),
    summary: {
      images,
      likely_scale: classifications.scale || 0,
      likely_prize: classifications.prize || 0,
      likely_static: classifications.static || 0,
      unknown: 0,
      other: 0,
    },
  }
}

test('MVP-04 runtime summary keeps character and cover counts separate', () => {
  const result = summarizeMultiCharacterRuntime(
    gallery({ products: 7, images: 56, manual: 5, classifications: { scale: 7 } }),
    gallery({ products: 10, images: 40, manual: 1, classifications: { scale: 9, static: 1 } }),
  )
  assert.equal(result.characters, 2)
  assert.deepEqual(result.cheshire.covers, { automatic: 2, manual: 5, missing: 0 })
  assert.deepEqual(result.rem.covers, { automatic: 9, manual: 1, missing: 0 })
  assert.equal(result.rem.manufacturers, 4)
})
