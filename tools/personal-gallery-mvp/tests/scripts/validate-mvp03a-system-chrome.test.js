import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeCoverReview } from '../../scripts/validate-mvp03a-system-chrome.mjs'

test('MVP-03A cover review summary separates automatic, manual, and missing covers', () => {
  const gallery = {
    products: [
      { images: [{}], coverSelectionSource: 'official_primary', coverImage: {} },
      { images: [{}], coverSelectionSource: 'manual_override', coverImage: {} },
      { images: [], coverSelectionSource: 'none', coverImage: null },
    ],
  }
  assert.deepEqual(summarizeCoverReview(gallery), {
    reviewed: 2,
    automatic: 1,
    manualOverride: 1,
    missing: 1,
  })
})
