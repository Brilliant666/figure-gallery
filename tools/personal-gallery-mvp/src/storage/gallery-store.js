import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteJson, readJson, updateJson } from './json-files.js'
import { businessFields, changedFields, fieldDigest, productIdentity } from './identity.js'
import { ensureRuntimeMarker } from './runtime-root.js'
import { ensureSourceStatus } from './source-status.js'
import { isCharacterUrl, normalizePageUrl, sanitizeUrlForRecord } from '../parsers/urls.js'

const EMPTY_INDEX = Object.freeze({ schemaVersion: 1, runs: [], queries: {} })
const EMPTY_IMAGE_INDEX = Object.freeze({ schemaVersion: 1, objects: {}, urlHistory: {} })
const EMPTY_PREFERENCES = Object.freeze({
  schemaVersion: 2,
  excludedProductIds: [],
  excludedImageSha256: [],
  products: {},
  preferredCoverImage: {},
  manualNote: {},
})

function now(clock) {
  return clock().toISOString()
}

function unique(values) {
  return [...new Set(values)]
}

function sanitizeEmbeddedUrls(value) {
  return String(value).replace(/https?:\/\/[^\s"']+/gi, (candidate) => sanitizeUrlForRecord(candidate) || '[REDACTED_URL]')
}

function sanitizeManifestRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const output = {}
  for (const [key, item] of Object.entries(value)) {
    if (/(?:api_?key|authorization|cookie|password|secret|token)$/i.test(key)) continue
    if (/url$/i.test(key) && typeof item === 'string') {
      output[key] = sanitizeUrlForRecord(item)
    } else if (key === 'message' && typeof item === 'string') {
      output[key] = sanitizeEmbeddedUrls(item)
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      output[key] = sanitizeManifestRecord(item)
    } else {
      output[key] = item
    }
  }
  return output
}

export class GalleryStore {
  constructor(root, { clock = () => new Date(), idFactory = randomUUID } = {}) {
    if (!root) throw new Error('GalleryStore requires a runtime root.')
    this.root = path.resolve(root)
    this.clock = clock
    this.idFactory = idFactory
    this.indexPath = path.join(this.root, 'index.json')
    this.imageIndexPath = path.join(this.root, 'image-index.json')
    this.preferencesPath = path.join(this.root, 'preferences.json')
  }

  async initialize() {
    await Promise.all([
      mkdir(path.join(this.root, 'runs'), { recursive: true }),
      mkdir(path.join(this.root, 'products'), { recursive: true }),
      mkdir(path.join(this.root, 'objects', 'sha256'), { recursive: true }),
    ])
    await ensureRuntimeMarker(this.root)
    await ensureSourceStatus(this.root)
    if ((await readJson(this.indexPath)) === null) await atomicWriteJson(this.indexPath, EMPTY_INDEX)
    if ((await readJson(this.imageIndexPath)) === null) await atomicWriteJson(this.imageIndexPath, EMPTY_IMAGE_INDEX)
    if ((await readJson(this.preferencesPath)) === null) await atomicWriteJson(this.preferencesPath, EMPTY_PREFERENCES)
    return this
  }

  runDirectory(runId) {
    return path.join(this.root, 'runs', runId)
  }

  runFile(runId, filename) {
    return path.join(this.runDirectory(runId), filename)
  }

  productFile(productKey) {
    return path.join(this.root, 'products', `${productKey}.json`)
  }

  objectPath(sha, extension) {
    return path.join(this.root, 'objects', 'sha256', sha.slice(0, 2), `${sha}.${extension}`)
  }

  async createRun({
    query,
    characterUrl = null,
    characterSlug = null,
    discoveryQueries = [],
    limits = {},
    requestedRunId = null,
    sourceMode = 'hpoi',
  }) {
    if (characterUrl !== null) {
      const normalizedCharacterUrl = normalizePageUrl(characterUrl)
      if (!normalizedCharacterUrl || !isCharacterUrl(normalizedCharacterUrl)) {
        throw new Error('characterUrl must be a credential-free Hpoi character URL.')
      }
      characterUrl = normalizedCharacterUrl
    }
    await this.initialize()
    const timestamp = now(this.clock)
    if (requestedRunId !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(requestedRunId)) {
      throw new Error('requestedRunId must be a safe filename segment no longer than 128 characters.')
    }
    const runId = requestedRunId || `${timestamp.replace(/[:.]/g, '-')}-${this.idFactory()}`
    const run = {
      schemaVersion: 1,
      runId,
      query,
      characterUrl,
      characterSlug,
      discoveryQueries: [...new Set(discoveryQueries.filter((value) => typeof value === 'string' && value.trim()))],
      sourceMode,
      status: 'running',
      startedAt: timestamp,
      completedAt: null,
      limits,
      counters: {
        pages: 0,
        productsDiscovered: 0,
        productsProcessed: 0,
        productsNew: 0,
        productsUnchanged: 0,
        productsChanged: 0,
        productFailures: 0,
        imageUrls: 0,
        imageUrlsOmitted: 0,
        imagesDownloaded: 0,
        imageFailures: 0,
        uniqueObjects: 0,
        duplicateImages: 0,
        firecrawlOperations: 0,
        firecrawlRequests: 0,
        firecrawlCredits: 0,
      },
      stopReason: null,
    }
    await mkdir(this.runDirectory(runId), { recursive: false })
    await Promise.all([
      atomicWriteJson(this.runFile(runId, 'run.json'), run),
      atomicWriteJson(this.runFile(runId, 'pages.json'), []),
      atomicWriteJson(this.runFile(runId, 'products.json'), []),
      atomicWriteJson(this.runFile(runId, 'failures.json'), []),
      atomicWriteJson(this.runFile(runId, 'parser-warnings.json'), []),
      atomicWriteJson(this.runFile(runId, 'requests.json'), []),
    ])
    await updateJson(this.indexPath, EMPTY_INDEX, (index) => {
      index.runs.unshift({
        runId,
        query,
        characterSlug,
        sourceMode,
        status: run.status,
        startedAt: timestamp,
        completedAt: null,
      })
      index.queries[query] = { latestRunId: runId, lastCollectedAt: timestamp }
      return index
    })
    return run
  }

  async readRun(runId) {
    return readJson(this.runFile(runId, 'run.json'))
  }

  async updateRun(runId, mutate) {
    return updateJson(this.runFile(runId, 'run.json'), null, (run) => {
      if (!run) throw new Error(`Unknown run: ${runId}`)
      return mutate(run)
    })
  }

  async recordPage(runId, page) {
    return this.#appendRunArray(runId, 'pages.json', sanitizeManifestRecord({ ...page, recordedAt: now(this.clock) }))
  }

  async recordFailure(runId, failure) {
    return this.#appendRunArray(runId, 'failures.json', sanitizeManifestRecord({ ...failure, recordedAt: now(this.clock) }))
  }

  async recordWarning(runId, warning) {
    return this.#appendRunArray(runId, 'parser-warnings.json', sanitizeManifestRecord({ ...warning, recordedAt: now(this.clock) }))
  }

  async recordRequest(runId, request) {
    const numberOrNull = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
      ? null
      : Number(value)
    const safe = {
      url: sanitizeUrlForRecord(request?.url),
      requestType: request?.requestType ?? null,
      startedAt: request?.startedAt ?? null,
      endedAt: request?.endedAt ?? null,
      durationMs: numberOrNull(request?.durationMs),
      firecrawlSuccess: request?.firecrawlSuccess === true,
      statusCode: numberOrNull(request?.statusCode),
      finalSourceUrl: sanitizeUrlForRecord(request?.finalSourceUrl),
      retries: Number.isInteger(numberOrNull(request?.retries)) ? Number(request.retries) : null,
      creditUsage: numberOrNull(request?.creditUsage),
      creditUsageKind: ['reported', 'reported_plus_estimated_retries', 'estimated_upper_bound'].includes(request?.creditUsageKind)
        ? request.creditUsageKind
        : null,
      failureCategory: request?.failureCategory ?? null,
    }
    return this.#appendRunArray(runId, 'requests.json', safe)
  }

  async #appendRunArray(runId, filename, item) {
    return updateJson(this.runFile(runId, filename), [], (items) => {
      items.push(item)
      return items
    })
  }

  async upsertProduct(runId, product) {
    const identity = productIdentity(product)
    const filePath = this.productFile(identity.key)
    const existing = await readJson(filePath)
    const timestamp = now(this.clock)
    const fields = structuredClone(product)
    delete fields.requestRecord
    delete fields.requestRecords
    const digestFields = businessFields(fields)
    const digest = fieldDigest(digestFields)
    let state = 'new'
    let changes = []
    let record

    if (existing) {
      changes = changedFields(businessFields(existing.fields), digestFields)
      state = existing.fieldDigest === digest ? 'unchanged' : 'changed'
      record = {
        ...existing,
        identity,
        fields,
        fieldDigest: digest,
        lastSeenAt: timestamp,
        lastParsedAt: product.parsedAt || existing.lastParsedAt || null,
        lastCollectedAt: product.collectedAt || product.observedAt || timestamp,
        imageSha256: existing.imageSha256 || [],
      }
      if (state === 'changed') {
        record.changeHistory = [
          ...(existing.changeHistory || []),
          {
            runId,
            changedAt: timestamp,
            beforeDigest: existing.fieldDigest,
            afterDigest: digest,
            changedFields: changes,
          },
        ]
      }
    } else {
      record = {
        schemaVersion: 1,
        productKey: identity.key,
        identity,
        fields,
        fieldDigest: digest,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        firstCollectedAt: product.collectedAt || product.observedAt || timestamp,
        lastCollectedAt: product.collectedAt || product.observedAt || timestamp,
        lastParsedAt: product.parsedAt || null,
        imageSha256: [],
        changeHistory: [],
      }
    }

    await atomicWriteJson(filePath, record)
    await this.#appendRunArray(runId, 'products.json', {
      productKey: identity.key,
      state,
      fields: structuredClone(fields),
      imageSha256: [...(record.imageSha256 || [])],
      beforeDigest: existing?.fieldDigest ?? null,
      afterDigest: digest,
      changedFields: changes,
      observedAt: timestamp,
    })
    return { identity, productKey: identity.key, state, changedFields: changes, record }
  }

  async registerImages(registrations) {
    if (!Array.isArray(registrations) || registrations.length === 0) return
    const timestamp = now(this.clock)
    await updateJson(this.imageIndexPath, EMPTY_IMAGE_INDEX, (index) => {
      for (const { productKey, url, sourceProductUrl, image } of registrations) {
        const recordedUrl = sanitizeUrlForRecord(url)
        const recordedSourceProductUrl = sanitizeUrlForRecord(sourceProductUrl)
        const prior = index.objects[image.sha256]
        index.objects[image.sha256] = {
          sha256: image.sha256,
          extension: image.extension,
          mime: image.mime,
          bytes: image.bytes,
          width: image.width,
          height: image.height,
          storagePath: path.relative(this.root, image.path).replaceAll('\\', '/'),
          firstStoredAt: prior?.firstStoredAt || timestamp,
          lastSeenAt: timestamp,
          sourceUrls: unique([...(prior?.sourceUrls || []), recordedUrl].filter(Boolean)),
          sourceProductUrls: unique([...(prior?.sourceProductUrls || []), recordedSourceProductUrl].filter(Boolean)),
          productKeys: unique([...(prior?.productKeys || []), productKey]),
        }
        if (recordedUrl) {
          const history = index.urlHistory[recordedUrl] || []
          index.urlHistory[recordedUrl] = unique([...history, image.sha256])
        }
      }
      return index
    })

    const byProduct = new Map()
    const byRunAndProduct = new Map()
    for (const registration of registrations) {
      const productImages = byProduct.get(registration.productKey) || []
      productImages.push(registration.image.sha256)
      byProduct.set(registration.productKey, productImages)
      if (registration.runId) {
        const key = `${registration.runId}\u0000${registration.productKey}`
        const runImages = byRunAndProduct.get(key) || {
          runId: registration.runId,
          productKey: registration.productKey,
          images: [],
        }
        runImages.images.push(registration.image.sha256)
        byRunAndProduct.set(key, runImages)
      }
    }
    for (const [productKey, images] of byProduct) {
      await updateJson(this.productFile(productKey), null, (product) => {
        if (!product) throw new Error(`Unknown product: ${productKey}`)
        product.imageSha256 = unique([...(product.imageSha256 || []), ...images])
        return product
      })
    }
    for (const { runId, productKey, images } of byRunAndProduct.values()) {
      await updateJson(this.runFile(runId, 'products.json'), [], (products) => {
        const snapshot = [...products].reverse().find((entry) => entry?.productKey === productKey)
        if (!snapshot) throw new Error(`Run ${runId} has no product snapshot for ${productKey}.`)
        snapshot.imageSha256 = unique([...(snapshot.imageSha256 || []), ...images])
        return products
      })
    }
  }

  async registerImage(registration) {
    return this.registerImages([registration])
  }

  async readImageIndex() {
    return readJson(this.imageIndexPath, EMPTY_IMAGE_INDEX)
  }

  async readPreferences() {
    return readJson(this.preferencesPath, EMPTY_PREFERENCES)
  }

  async updatePreferences(mutate) {
    return updateJson(this.preferencesPath, EMPTY_PREFERENCES, (preferences) => {
      const next = mutate(preferences) || preferences
      next.schemaVersion = 2
      next.excludedProductIds = unique(next.excludedProductIds || [])
      next.excludedImageSha256 = unique(next.excludedImageSha256 || [])
      next.products = next.products && typeof next.products === 'object' ? next.products : {}
      next.preferredCoverImage =
        next.preferredCoverImage && typeof next.preferredCoverImage === 'object'
          ? next.preferredCoverImage
          : {}
      next.manualNote = next.manualNote && typeof next.manualNote === 'object' ? next.manualNote : {}
      return next
    })
  }

  excludeProduct(productKey) {
    return this.updatePreferences((preferences) => {
      preferences.excludedProductIds.push(productKey)
      return preferences
    })
  }

  restoreProduct(productKey) {
    return this.updatePreferences((preferences) => {
      preferences.excludedProductIds = preferences.excludedProductIds.filter((value) => value !== productKey)
      return preferences
    })
  }

  excludeImage(imageSha256) {
    return this.updatePreferences((preferences) => {
      preferences.excludedImageSha256.push(imageSha256)
      return preferences
    })
  }

  restoreImage(imageSha256) {
    return this.updatePreferences((preferences) => {
      preferences.excludedImageSha256 = preferences.excludedImageSha256.filter((value) => value !== imageSha256)
      return preferences
    })
  }

  setPreferredCover(productKey, imageSha256) {
    return this.updatePreferences((preferences) => {
      preferences.products ||= {}
      preferences.products[productKey] ||= {}
      preferences.products[productKey].preferredCoverImageId = imageSha256
      preferences.preferredCoverImage ||= {}
      preferences.preferredCoverImage[productKey] = imageSha256
      return preferences
    })
  }

  setManualNote(productKey, note) {
    return this.updatePreferences((preferences) => {
      preferences.products ||= {}
      preferences.products[productKey] ||= {}
      if (note) preferences.products[productKey].manualNote = note
      else delete preferences.products[productKey].manualNote
      preferences.manualNote ||= {}
      if (note) preferences.manualNote[productKey] = note
      else delete preferences.manualNote[productKey]
      if (Object.keys(preferences.products[productKey]).length === 0) delete preferences.products[productKey]
      return preferences
    })
  }

  async finalizeRun(runId, { status, stopReason = null, counters, extra = {} }) {
    const timestamp = now(this.clock)
    const requests = await readJson(this.runFile(runId, 'requests.json'), [])
    const requestCounters = {
      firecrawlOperations: requests.length,
      firecrawlRequests: requests.reduce((sum, request) => sum + 1 + Math.max(0, Number(request.retries) || 0), 0),
      firecrawlCredits: requests.reduce((sum, request) => sum + Math.max(0, Number(request.creditUsage) || 0), 0),
    }
    const run = await this.updateRun(runId, (current) => ({
      ...current,
      ...extra,
      status,
      stopReason,
      counters: { ...(counters || current.counters), ...requestCounters },
      completedAt: timestamp,
    }))
    await updateJson(this.indexPath, EMPTY_INDEX, (index) => {
      const entry = index.runs.find((candidate) => candidate.runId === runId)
      if (entry) Object.assign(entry, { status, completedAt: timestamp, stopReason })
      if (index.queries[run.query]) {
        Object.assign(index.queries[run.query], { latestRunId: runId, lastCollectedAt: timestamp })
      }
      return index
    })
    return run
  }
}

export async function createGalleryStore(root, options) {
  return new GalleryStore(root, options).initialize()
}
