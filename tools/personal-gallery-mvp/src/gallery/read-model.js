import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { HPOI_FROZEN_STATUS, readSourceStatus } from '../storage/source-status.js'
import {
  characterPreferencesPath,
  ensureCharacterStorage,
  listCharacterRunIds,
  resolveCharacterConfig,
} from '../storage/character-store.js'

const DEFAULT_PREFERENCES = Object.freeze({
  schemaVersion: 2,
  excludedProductIds: [],
  excludedImageSha256: [],
  products: {},
  preferredCoverImage: {},
  manualNote: {},
})

const PROJECTION_IMAGE_HOSTS = new Set([
  'cdn.shopify.com',
  'images.goodsmile.info',
  'www.goodsmile.com',
])

const PROJECTION_SOURCE_FAMILIES = new Set([
  'goodsmile',
  'solaris',
  'japan-figure',
  'unknown',
])

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function cleanText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function safeProjectionImageUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' &&
      PROJECTION_IMAGE_HOSTS.has(parsed.hostname.toLowerCase()) &&
      !parsed.username &&
      !parsed.password
      ? parsed.href
      : ''
  } catch {
    return ''
  }
}

function sourceDomainFrom(fields) {
  const explicit = cleanText(fields.sourceDomain).toLowerCase()
  if (explicit) return explicit
  try {
    return new URL(fields.sourceUrl || fields.url || fields.canonicalUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function normalizeHpoiSourceStatus(sourceStatus = {}) {
  const raw = sourceStatus?.hpoi && typeof sourceStatus.hpoi === 'object'
    ? sourceStatus.hpoi
    : {}
  return {
    ...HPOI_FROZEN_STATUS,
    ...raw,
    hpoiLiveStatus: 'blocked_by_source',
    stopReason: 'captcha',
    retryAllowed: false,
    blockedAt: raw.blockedAt || HPOI_FROZEN_STATUS.blockedAt,
    consecutiveBlockedRuns: Math.max(3, Number(raw.consecutiveBlockedRuns) || 0),
  }
}

export function normalizeQuery(value) {
  return cleanText(value, 'gallery')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'gallery'
}

export function normalizePreferences(raw = {}) {
  const legacyCovers =
    raw.preferredCoverImage && typeof raw.preferredCoverImage === 'object'
      ? raw.preferredCoverImage
      : {}
  const legacyNotes = raw.manualNote && typeof raw.manualNote === 'object' ? raw.manualNote : {}
  const rawProducts = raw.products && typeof raw.products === 'object' ? raw.products : {}
  const products = {}
  const productIds = new Set([
    ...Object.keys(rawProducts),
    ...Object.keys(legacyCovers),
    ...Object.keys(legacyNotes),
  ])
  for (const productId of productIds) {
    if (typeof productId !== 'string' || !productId) continue
    const source = rawProducts[productId] && typeof rawProducts[productId] === 'object'
      ? rawProducts[productId]
      : {}
    const preferredCoverValue = cleanText(
      source.preferredCoverImageUrl || source.preferredCoverImageId || legacyCovers[productId],
    )
    const preferredCoverImageId = /^[a-f\d]{64}$/i.test(preferredCoverValue)
      ? preferredCoverValue.toLowerCase()
      : ''
    const preferredCoverImageUrl = safeProjectionImageUrl(preferredCoverValue)
    const manualNote = cleanText(source.manualNote || legacyNotes[productId])
    const entry = {}
    if (preferredCoverImageId) entry.preferredCoverImageId = preferredCoverImageId
    if (preferredCoverImageUrl) entry.preferredCoverImageUrl = preferredCoverImageUrl
    if (manualNote) entry.manualNote = manualNote
    if (Object.keys(entry).length > 0) products[productId] = entry
  }
  const preferredCoverImage = Object.fromEntries(
    Object.entries(products)
      .filter(([, value]) => value.preferredCoverImageUrl || value.preferredCoverImageId)
      .map(([productId, value]) => [
        productId,
        value.preferredCoverImageUrl || value.preferredCoverImageId,
      ]),
  )
  const manualNote = Object.fromEntries(
    Object.entries(products)
      .filter(([, value]) => value.manualNote)
      .map(([productId, value]) => [productId, value.manualNote]),
  )
  return {
    schemaVersion: 2,
    excludedProductIds: [...new Set(asArray(raw.excludedProductIds).filter((item) => typeof item === 'string'))],
    excludedImageSha256: [
      ...new Set(asArray(raw.excludedImageSha256).filter((item) => /^[a-f\d]{64}$/i.test(item))),
    ],
    products,
    // Kept as normalized compatibility projections for the MVP-01/MVP-02 runtime.
    preferredCoverImage,
    manualNote,
  }
}

function normalizeImage(image, productId, excludedImages, homepageImage, order) {
  if (!image || typeof image !== 'object') return null
  const sha256 = cleanText(image.sha256 || image.contentSha256 || image.digest).toLowerCase()
  if (!/^[a-f\d]{64}$/.test(sha256)) return null
  const sourceUrls = [
    ...asArray(image.sourceUrls),
    image.sourceUrl,
    image.url,
  ].filter((value, index, all) => typeof value === 'string' && value && all.indexOf(value) === index)
  return {
    sha256,
    width: Number.isFinite(Number(image.width)) ? Number(image.width) : null,
    height: Number.isFinite(Number(image.height)) ? Number(image.height) : null,
    bytes: Number.isFinite(Number(image.bytes)) ? Number(image.bytes) : null,
    mime: cleanText(image.mime || image.contentType, 'image/jpeg'),
    sourceUrl: cleanText(sourceUrls[0]),
    alt: cleanText(image.alt, `Candidate image for ${productId}`),
    excluded: excludedImages.has(sha256),
    isOfficialPrimary:
      image.isOfficialPrimary === true ||
      image.isPrimary === true ||
      Boolean(homepageImage && sourceUrls.includes(homepageImage)),
    order,
    mediaUrl: `/media/${sha256}`,
  }
}

function recommendationScore(image) {
  const width = Number(image.width) || 0
  const height = Number(image.height) || 0
  const area = width * height
  if (area < 120_000 || width <= 0 || height <= 0) return null
  const ratio = width / height
  if (ratio < 0.34 || ratio > 2.6) return null
  const ratioPenalty = Math.abs(Math.log(ratio / 0.82)) * 150_000
  return area - ratioPenalty - (Number(image.order) || 0) * 1_000
}

export function selectCoverImage(images = [], preferredCoverImageId = '') {
  const available = images.filter((image) => image && !image.excluded)
  const preferred = available.find((image) => image.sha256 === preferredCoverImageId)
  if (preferred) {
    return { image: preferred, source: 'manual_override', preferredCoverUnavailable: false }
  }
  const officialPrimary = available.find((image) => image.isOfficialPrimary)
  if (officialPrimary) {
    return {
      image: officialPrimary,
      source: 'official_primary',
      preferredCoverUnavailable: Boolean(preferredCoverImageId),
    }
  }
  const recommended = available
    .map((image) => ({ image, score: recommendationScore(image) }))
    .filter((candidate) => candidate.score !== null)
    .sort((left, right) => right.score - left.score || left.image.order - right.image.order)[0]?.image
  if (recommended) {
    return {
      image: recommended,
      source: 'automatic_recommendation',
      preferredCoverUnavailable: Boolean(preferredCoverImageId),
    }
  }
  return {
    image: available[0] || null,
    source: available.length > 0 ? 'first_valid' : 'none',
    preferredCoverUnavailable: Boolean(preferredCoverImageId),
  }
}

function failureUrl(failure) {
  return cleanText(failure?.url || failure?.sourceUrl || failure?.imageUrl)
}

function productImageUrls(fields) {
  return new Set([
    fields.homepageImage,
    ...asArray(fields.imageUrls),
    ...asArray(fields.candidateImages).flatMap((image) =>
      typeof image === 'string' ? [image] : [image?.url, image?.sourceUrl]),
  ].filter((value) => typeof value === 'string' && value))
}

function safeProductFailures(fields, failures) {
  const imageUrls = productImageUrls(fields)
  return failures
    .filter((failure) => imageUrls.has(failureUrl(failure)))
    .map((failure) => ({
      kind: cleanText(failure.kind || failure.type || failure.stage, 'image'),
      code: cleanText(failure.code || failure.reason, 'unknown'),
      status: Number.isFinite(Number(failure.status || failure.statusCode))
        ? Number(failure.status || failure.statusCode)
        : null,
      recordedAt: failure.recordedAt || null,
    }))
}

function normalizeProduct(product, preferences, imageObjects = {}, failures = []) {
  if (!product || typeof product !== 'object') return null
  const fields = product.fields && typeof product.fields === 'object' ? product.fields : product
  const id = cleanText(
    product.productKey ||
      fields.id ||
      fields.productId ||
      fields.sourceItemId ||
      fields.hpoiProductId ||
      product.identity?.sourceItemId ||
      (typeof product.identity === 'string' ? product.identity : ''),
  )
  if (!id) return null

  const excludedImages = new Set(preferences.excludedImageSha256)
  const homepageImage = cleanText(fields.homepageImage)
  const storedImages = asArray(product.imageSha256)
    .map((sha256) => imageObjects[sha256] || (typeof sha256 === 'string' ? { sha256 } : sha256))
  const images = [
    ...storedImages,
    ...asArray(fields.images || fields.candidateImages || fields.imageRecords || fields.media),
  ]
    .map((image, index) => normalizeImage(image, id, excludedImages, homepageImage, index))
    .filter(
      (image, index, all) =>
        image && all.findIndex((candidate) => candidate?.sha256 === image.sha256) === index,
    )

  const classification = cleanText(
    fields.classification || fields.bucket || fields.typeBucket || fields.figureType,
    'unknown',
  )
  const preferredCoverImageId = cleanText(
    preferences.products?.[id]?.preferredCoverImageId || preferences.preferredCoverImage[id],
  )
  const cover = selectCoverImage(images, preferredCoverImageId)
  const imageFailures = safeProductFailures(fields, failures)

  const sourceDomain = sourceDomainFrom(fields)
  const sourceKind = cleanText(
    fields.sourceKind,
    sourceDomain === 'hpoi.net' || sourceDomain === 'www.hpoi.net' ? 'legacy_hpoi' : 'unknown',
  )

  return {
    id,
    title: cleanText(fields.title || fields.rawTitle, `Product ${id}`),
    design: cleanText(fields.design || fields.variant || fields.title || fields.rawTitle, `Product ${id}`),
    sourceKind,
    sourceDomain,
    discoveryQuery: cleanText(fields.discoveryQuery),
    discoveryMethod: cleanText(fields.discoveryMethod),
    officialProductId: cleanText(fields.officialProductId || product.identity?.sourceItemId),
    character: cleanText(fields.character || fields.rawCharacterNames),
    series: cleanText(fields.series || fields.work || fields.rawWorkName),
    manufacturer: cleanText(fields.manufacturer || fields.rawManufacturer, 'unknown'),
    distributor: cleanText(fields.distributor),
    classification: ['likely_scale', 'likely_prize', 'likely_static', 'other', 'unknown'].includes(classification)
      ? classification
      : 'unknown',
    category: cleanText(fields.category || fields.rawCategory, 'unknown'),
    scale: cleanText(fields.scale || fields.rawScale, 'unknown'),
    height: cleanText(fields.height),
    releaseDate: cleanText(fields.releaseDate || fields.rawReleaseDate, 'unknown'),
    price: cleanText(fields.price),
    sculptor: cleanText(fields.sculptor),
    paintwork: cleanText(fields.paintwork),
    description: cleanText(fields.description),
    sourceUrl: cleanText(fields.sourceUrl || fields.url || fields.canonicalUrl),
    status: cleanText(fields.status || fields.releaseStatus || fields.rawReleaseStatus, 'unknown'),
    parserVersion: cleanText(fields.parserVersion),
    lastSeenAt: fields.lastSeenAt || product.lastSeenAt || null,
    fieldDigest: cleanText(fields.fieldDigest || product.fieldDigest),
    images,
    coverImage: cover.image,
    coverSelectionSource: cover.source,
    preferredCoverUnavailable: cover.preferredCoverUnavailable,
    excluded: preferences.excludedProductIds.includes(id),
    note: cleanText(preferences.products?.[id]?.manualNote || preferences.manualNote[id]),
    preferredCoverImageId,
    // Compatibility alias for pre-MVP-03A callers.
    preferredCoverImage: preferredCoverImageId,
    imageFailures,
    failureCount: imageFailures.length,
  }
}

function summarize(products, failures) {
  const buckets = { likely_scale: 0, likely_prize: 0, likely_static: 0, unknown: 0, other: 0 }
  let images = 0
  let officialImages = 0
  for (const product of products) {
    buckets[product.classification] += 1
    images += product.images.length
    if (['official_manufacturer', 'official_distributor'].includes(product.sourceKind)) {
      officialImages += product.images.length
    }
  }
  const officialProducts = products.filter((product) =>
    ['official_manufacturer', 'official_distributor'].includes(product.sourceKind),
  ).length
  const covers = products.filter((product) => product.coverImage)
  return {
    products: products.length,
    images,
    officialProducts,
    officialImages,
    failures: failures.length,
    indexCovers: covers.length,
    automaticCovers: covers.filter((product) => product.coverSelectionSource !== 'manual_override').length,
    manualCovers: covers.filter((product) => product.coverSelectionSource === 'manual_override').length,
    productsWithoutImages: products.filter((product) => product.images.length === 0).length,
    ...buckets,
  }
}

function projectionImageIdentity(url) {
  return createHash('sha256').update(url).digest('hex')
}

function normalizeProjectionSourceFamily(value) {
  const normalized = cleanText(value, 'unknown').toLowerCase()
  return PROJECTION_SOURCE_FAMILIES.has(normalized) ? normalized : 'unknown'
}

function normalizeProjectionClassification(value, category = '') {
  const normalized = cleanText(value).toLowerCase().replace(/[\s-]+/gu, '_')
  if (['scale', 'likely_scale'].includes(normalized)) return 'likely_scale'
  if (['prize', 'likely_prize'].includes(normalized)) return 'likely_prize'
  if (['static', 'likely_static'].includes(normalized)) return 'likely_static'
  const categoryValue = cleanText(category).toLowerCase()
  if (/prize|景品/iu.test(categoryValue)) return 'likely_prize'
  if (/scale|比例/iu.test(categoryValue)) return 'likely_scale'
  return 'unknown'
}

function normalizeProjectionImage(image, prototypeId, excludedImages, order) {
  if (!image || typeof image !== 'object') return null
  const url = safeProjectionImageUrl(image.url || image.sourceUrl)
  if (!url) return null
  const sha256 = projectionImageIdentity(url)
  const sourceFamily = normalizeProjectionSourceFamily(image.sourceFamily)
  return {
    id: cleanText(image.id, `image-ref-${sha256.slice(0, 16)}`),
    sha256,
    width: Number.isFinite(Number(image.width)) ? Number(image.width) : null,
    height: Number.isFinite(Number(image.height)) ? Number(image.height) : null,
    bytes: null,
    mime: cleanText(image.mime, 'image/jpeg'),
    sourceUrl: url,
    url,
    mediaUrl: url,
    catalogItemId: cleanText(image.catalogItemId),
    sourceFamily,
    alt: cleanText(image.alt, `Reference image for ${prototypeId}`),
    excluded: excludedImages.has(sha256),
    isOfficialPrimary: sourceFamily === 'goodsmile' && image.isMain === true,
    isMain: image.isMain === true,
    remote: true,
    order,
  }
}

function normalizeProjectionSource(source) {
  if (!source || typeof source !== 'object') return null
  let url = ''
  try {
    const parsed = new URL(source.url)
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) url = parsed.href
  } catch {
    return null
  }
  if (!url) return null
  const host = new URL(url).hostname.toLowerCase()
  const inferredFamily = host === 'solarisjapan.com' || host === 'www.solarisjapan.com'
    ? 'solaris'
    : host === 'japan-figure.com' || host === 'www.japan-figure.com'
      ? 'japan-figure'
      : host === 'goodsmile.com' || host === 'www.goodsmile.com' ||
          host === 'goodsmile.info' || host === 'www.goodsmile.info' ||
          host === 'images.goodsmile.info'
        ? 'goodsmile'
        : 'unknown'
  return {
    url,
    sourceFamily: normalizeProjectionSourceFamily(source.sourceFamily || inferredFamily),
    label: cleanText(source.label),
  }
}

function normalizeProjectionCatalogItem(item) {
  if (!item || typeof item !== 'object') return null
  const id = cleanText(item.id || item.catalogItemId)
  if (!id) return null
  const sources = asArray(item.sources)
    .map(normalizeProjectionSource)
    .filter((source, index, all) =>
      source && all.findIndex((candidate) => candidate?.url === source.url) === index,
    )
  for (const sourceUrl of asArray(item.sourceUrls)) {
    const normalized = normalizeProjectionSource({
      url: sourceUrl,
      sourceFamily: item.sourceFamily,
      label: '',
    })
    if (normalized && !sources.some((source) => source.url === normalized.url)) sources.push(normalized)
  }
  return {
    id,
    title: cleanText(item.title, id),
    manufacturer: cleanText(item.manufacturer, 'unknown'),
    category: cleanText(item.category, 'unknown'),
    classification: normalizeProjectionClassification(item.classification || item.type, item.category),
    scale: cleanText(item.scale, 'unknown'),
    release: cleanText(item.release || item.releaseDate),
    source: cleanText(item.source),
    sources,
  }
}

function selectProjectionCover(images, preferredUrl, projectedCover) {
  const available = images.filter((image) => !image.excluded)
  if (preferredUrl) {
    const preferred = available.find((image) => image.url === preferredUrl)
    if (preferred) return { image: preferred, source: 'manual_override', preferredCoverUnavailable: false }
  }
  const projectedUrl = safeProjectionImageUrl(projectedCover?.url || projectedCover?.sourceUrl)
  const projectedId = cleanText(projectedCover?.id)
  const selected = available.find((image) =>
    (projectedUrl && image.url === projectedUrl) || (projectedId && image.id === projectedId),
  )
  if (selected) {
    return {
      image: selected,
      source: 'projection_rule',
      preferredCoverUnavailable: Boolean(preferredUrl),
    }
  }
  const fallback = available.find((image) => image.sourceFamily === 'goodsmile' && image.isMain) ||
    available.find((image) => image.sourceFamily === 'goodsmile') ||
    available.find((image) => image.isMain) ||
    available[0] ||
    null
  return {
    image: fallback,
    source: fallback ? 'projection_rule' : 'none',
    preferredCoverUnavailable: Boolean(preferredUrl),
  }
}

function normalizeProjectionPrototype(prototype, preferences) {
  if (!prototype || typeof prototype !== 'object') return null
  const id = cleanText(prototype.prototypeId || prototype.id)
  if (!id) return null
  const excludedImages = new Set(preferences.excludedImageSha256)
  const images = asArray(prototype.images)
    .map((image, index) => normalizeProjectionImage(image, id, excludedImages, index))
    .filter((image, index, all) =>
      image && all.findIndex((candidate) => candidate?.url === image.url) === index,
    )
  const preference = preferences.products?.[id] || {}
  const preferredCoverImageUrl = cleanText(preference.preferredCoverImageUrl)
  const cover = selectProjectionCover(images, preferredCoverImageUrl, prototype.cover)
  const catalogItems = asArray(prototype.catalogItems).map(normalizeProjectionCatalogItem).filter(Boolean)
  const sources = asArray(prototype.sources)
    .map(normalizeProjectionSource)
    .filter((source, index, all) =>
      source && all.findIndex((candidate) => candidate?.url === source.url) === index,
    )
  for (const item of catalogItems) {
    for (const source of item.sources) {
      if (!sources.some((candidate) => candidate.url === source.url)) sources.push(source)
    }
  }
  const manufacturers = [
    ...new Set([
      ...asArray(prototype.manufacturers),
      prototype.manufacturer,
      ...catalogItems.map((item) => item.manufacturer),
    ].map((value) => cleanText(value)).filter(Boolean)),
  ]
  const classification = normalizeProjectionClassification(
    prototype.classification || prototype.type,
    prototype.category,
  )
  return {
    id,
    prototypeId: id,
    viewMode: 'prototype_projection',
    catalogItemIds: asArray(prototype.catalogItemIds).filter((value) => typeof value === 'string'),
    groupedCatalogItemCount: Number(prototype.groupedCatalogItemCount) || catalogItems.length,
    title: cleanText(prototype.title, `Prototype ${id}`),
    design: cleanText(prototype.title, `Prototype ${id}`),
    manufacturer: cleanText(prototype.manufacturer || manufacturers[0], 'unknown'),
    manufacturers,
    classification,
    category: cleanText(prototype.category, 'unknown'),
    scale: cleanText(prototype.scale || catalogItems.find((item) => item.scale !== 'unknown')?.scale, 'unknown'),
    charactersHint: asArray(prototype.charactersHint).filter((value) => typeof value === 'string'),
    images,
    coverImage: cover.image,
    coverSelectionSource: cover.source,
    preferredCoverUnavailable: cover.preferredCoverUnavailable,
    preferredCoverImageUrl,
    preferredCoverImageId: preferredCoverImageUrl,
    excluded: preferences.excludedProductIds.includes(id),
    note: cleanText(preference.manualNote || preferences.manualNote[id]),
    catalogItems,
    sources,
    failures: [],
    imageFailures: [],
    failureCount: 0,
  }
}

async function readPrototypeProjection(root, characterSlug) {
  const canonical = path.join(root, 'characters', characterSlug, 'prototype-projection.json')
  const legacy = path.join(root, `${characterSlug}-prototype-projection.json`)
  return (await readJson(canonical)) || (await readJson(legacy))
}

export async function loadPrototypeGallery(root, character) {
  if (!character) return null
  const projection = await readPrototypeProjection(root, character.slug)
  if (!projection || projection.viewMode !== 'prototype_projection' || !Array.isArray(projection.prototypes)) {
    return null
  }
  const preferences = normalizePreferences(
    await readJson(characterPreferencesPath(root, character.slug), DEFAULT_PREFERENCES),
  )
  const prototypes = projection.prototypes
    .map((prototype) => normalizeProjectionPrototype(prototype, preferences))
    .filter(Boolean)
  const failures = []
  const calculated = summarize(prototypes, failures)
  const providedSummary = projection.summary && typeof projection.summary === 'object'
    ? projection.summary
    : {}
  const summary = {
    ...calculated,
    ...providedSummary,
    products: prototypes.length,
    prototypes: prototypes.length,
    prototypeCount: prototypes.length,
    catalogItemCount: Number(providedSummary.catalogItemCount ?? projection.sourceCatalogItemCount) || 0,
    projectionEligibleCount:
      Number(providedSummary.projectionEligibleCount ?? projection.projectionEligibleItemCount) || 0,
    imageCount: prototypes.reduce((total, prototype) => total + prototype.images.length, 0),
    prototypeWithImageCount: prototypes.filter((prototype) => prototype.coverImage).length,
  }
  return {
    runId: cleanText(projection.projectionVersion, 'prototype-projection'),
    projectionVersion: cleanText(projection.projectionVersion, 'prototype-projection'),
    viewMode: 'prototype_projection',
    query: character.displayName,
    characterId: character.characterId,
    character: {
      characterId: character.characterId,
      slug: character.slug,
      displayName: character.displayName,
      aliases: [...character.aliases],
      workNames: [...character.workNames],
    },
    querySlug: character.slug,
    characterSlug: character.slug,
    sourceMode: 'prototype_projection',
    sourceStatus: { hpoi: normalizeHpoiSourceStatus(await readSourceStatus(root)) },
    status: 'completed',
    startedAt: projection.generatedAt || null,
    completedAt: projection.generatedAt || null,
    stopReason: null,
    products: prototypes,
    prototypes,
    failures,
    summary,
    preferences,
    grouping: projection.grouping || null,
    excludedCatalogItems: asArray(projection.excludedCatalogItems),
  }
}

async function listRunIds(root) {
  try {
    const entries = await fs.readdir(path.join(root, 'runs'), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function loadProductReference(root, value) {
  if (value && typeof value === 'object') {
    if (value.fields || value.images || value.candidateImages) return value
    if (typeof value.productKey === 'string') {
      return readJson(path.join(root, 'products', `${value.productKey}.json`))
    }
    return value
  }
  if (typeof value !== 'string' || !value) return null
  return readJson(path.join(root, 'products', `${value}.json`))
}

export async function loadRunGallery(root, requestedRunId = null) {
  const runIds = await listRunIds(root)
  const runId = requestedRunId || runIds[0] || null
  if (!runId || !runIds.includes(runId)) return null

  const runDirectory = path.join(root, 'runs', runId)
  let run = (await readJson(path.join(runDirectory, 'run.json'), {}) ) || {}
  const character = await resolveCharacterConfig(
    root,
    run.characterId || run.characterSlug || run.query || run.characterName || run.input?.query,
  )
  if (character) {
    await ensureCharacterStorage(root, character)
    run = (await readJson(path.join(runDirectory, 'run.json'), run)) || run
  }
  const preferences = normalizePreferences(
    await readJson(
      character ? characterPreferencesPath(root, character.slug) : path.join(root, 'preferences.json'),
      DEFAULT_PREFERENCES,
    ),
  )
  const imageIndex =
    (await readJson(path.join(root, 'image-index.json'), { objects: {} })) || { objects: {} }
  const failureDocument = await readJson(path.join(runDirectory, 'failures.json'), [])
  const failures = asArray(failureDocument?.failures ?? failureDocument)
  const productDocument = await readJson(path.join(runDirectory, 'products.json'), [])
  const rawProducts = asArray(productDocument?.products ?? productDocument)
  const resolvedProducts = await Promise.all(rawProducts.map((product) => loadProductReference(root, product)))
  const products = resolvedProducts
    .map((product) => normalizeProduct(product, preferences, imageIndex.objects || {}, failures))
    .filter(Boolean)
  const sourceStatus = await readSourceStatus(root)

  const query = cleanText(character?.displayName || run.query || run.characterName || run.input?.query, 'Unknown character')
  const querySlug = normalizeQuery(query)
  const characterSlug = normalizeQuery(run.characterSlug || query)

  return {
    runId,
    query,
    characterId: character?.characterId || cleanText(run.characterId),
    character: character ? {
      characterId: character.characterId,
      slug: character.slug,
      displayName: character.displayName,
      aliases: [...character.aliases],
      workNames: [...character.workNames],
    } : null,
    querySlug,
    characterSlug,
    sourceMode: cleanText(run.sourceMode, 'legacy_hpoi'),
    sourceStatus: { hpoi: normalizeHpoiSourceStatus(sourceStatus) },
    status: cleanText(run.status, 'unknown'),
    startedAt: run.startedAt || null,
    completedAt: run.completedAt || run.updatedAt || null,
    stopReason: run.stopReason || run.blockedReason || null,
    products,
    failures,
    summary: summarize(products, failures),
    preferences,
  }
}

export async function loadGalleryByQuery(root, query) {
  const character = await resolveCharacterConfig(root, query)
  const projection = await loadPrototypeGallery(root, character)
  if (projection) return projection
  const normalized = character?.slug || normalizeQuery(query)
  const matches = []
  const runIds = character ? await listCharacterRunIds(root, character) : await listRunIds(root)
  for (const runId of runIds) {
    const gallery = await loadRunGallery(root, runId)
    if (gallery && (
      (character && gallery.characterId === character.characterId) ||
      gallery.characterSlug === normalized ||
      gallery.querySlug === normalized
    )) matches.push(gallery)
  }
  return matches.find((gallery) =>
    ['running', 'stopping'].includes(gallery.status) && gallery.products.length > 0,
  ) || matches.find((gallery) => gallery.status === 'completed' && gallery.products.length > 0) || matches[0] || null
}

export async function listRecentRuns(root, limit = 10) {
  const output = []
  for (const runId of (await listRunIds(root)).slice(0, limit)) {
    const run = await readJson(path.join(root, 'runs', runId, 'run.json'), {})
    output.push({
      runId,
      query: cleanText(run?.query || run?.characterName || run?.input?.query, 'Unknown character'),
      characterSlug: normalizeQuery(run?.characterSlug || run?.query || run?.characterName || run?.input?.query),
      sourceMode: cleanText(run?.sourceMode, 'legacy_hpoi'),
      status: cleanText(run?.status, 'unknown'),
      startedAt: run?.startedAt || null,
      completedAt: run?.completedAt || run?.updatedAt || null,
    })
  }
  return output
}

export async function savePreferences(root, characterSlug, value) {
  const character = await resolveCharacterConfig(root, characterSlug)
  if (!character) throw new Error('Unknown character for preferences.')
  await ensureCharacterStorage(root, character)
  const preferences = normalizePreferences(value)
  const target = characterPreferencesPath(root, character.slug)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
  await fs.rename(temporary, target)
  return preferences
}

export async function resolveMediaObject(root, sha256) {
  if (!/^[a-f\d]{64}$/i.test(sha256)) return null
  const directory = path.join(root, 'objects', 'sha256', sha256.slice(0, 2).toLowerCase())
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const match = entries.find(
      (entry) => entry.isFile() && entry.name.toLowerCase().startsWith(`${sha256.toLowerCase()}.`),
    )
    return match ? path.join(directory, match.name) : null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}
