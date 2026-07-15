import { GalleryStore } from '../storage/gallery-store.js'
import { SequentialCollector } from './sequential-collector.js'

export { CollectionBlockedError, detectBlockingResult, errorFingerprint, toCollectionError } from './access-policy.js'
export { SequentialCollector } from './sequential-collector.js'

export async function collectGallery(options = {}) {
  const {
    query,
    characterUrl = null,
    limits = {},
    requestedRunId = null,
    provider,
    storage,
    root,
    signal,
    progress,
    parsers,
    config = {},
    ...dependencies
  } = options
  const store = storage || await new GalleryStore(root || config.root).initialize()
  const collector = new SequentialCollector({
    provider,
    store,
    parsers,
    config,
    progress,
    ...dependencies,
  })
  return collector.collect({ query, characterUrl, limits, requestedRunId, signal })
}

export const runCollector = collectGallery
