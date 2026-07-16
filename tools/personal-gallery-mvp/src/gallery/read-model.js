import { promises as fs } from 'node:fs'
import path from 'node:path'

const DEFAULT_PREFERENCES = Object.freeze({
  excludedProductIds: [],
  excludedImageSha256: [],
  preferredCoverImage: {},
  manualNote: {},
})

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

export function normalizeQuery(value) {
  return cleanText(value, 'gallery')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'gallery'
}

export function normalizePreferences(raw = {}) {
  return {
    excludedProductIds: [...new Set(asArray(raw.excludedProductIds).filter((item) => typeof item === 'string'))],
    excludedImageSha256: [
      ...new Set(asArray(raw.excludedImageSha256).filter((item) => /^[a-f\d]{64}$/i.test(item))),
    ],
    preferredCoverImage:
      raw.preferredCoverImage && typeof raw.preferredCoverImage === 'object'
        ? { ...raw.preferredCoverImage }
        : {},
    manualNote: raw.manualNote && typeof raw.manualNote === 'object' ? { ...raw.manualNote } : {},
  }
}

function normalizeImage(image, productId, excludedImages) {
  if (!image || typeof image !== 'object') return null
  const sha256 = cleanText(image.sha256 || image.contentSha256 || image.digest).toLowerCase()
  if (!/^[a-f\d]{64}$/.test(sha256)) return null
  return {
    sha256,
    width: Number.isFinite(Number(image.width)) ? Number(image.width) : null,
    height: Number.isFinite(Number(image.height)) ? Number(image.height) : null,
    mime: cleanText(image.mime || image.contentType, 'image/jpeg'),
    sourceUrl: cleanText(image.sourceUrl || image.url),
    alt: cleanText(image.alt, `Candidate image for ${productId}`),
    excluded: excludedImages.has(sha256),
    mediaUrl: `/media/${sha256}`,
  }
}

function normalizeProduct(product, preferences, imageObjects = {}) {
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
  const storedImages = asArray(product.imageSha256)
    .map((sha256) => imageObjects[sha256] || (typeof sha256 === 'string' ? { sha256 } : sha256))
  const images = [
    ...storedImages,
    ...asArray(fields.images || fields.candidateImages || fields.imageRecords || fields.media),
  ]
    .map((image) => normalizeImage(image, id, excludedImages))
    .filter(
      (image, index, all) =>
        image && all.findIndex((candidate) => candidate?.sha256 === image.sha256) === index,
    )

  const classification = cleanText(
    fields.classification || fields.bucket || fields.typeBucket || fields.figureType,
    'unknown',
  )
  const preferredCoverImage = cleanText(preferences.preferredCoverImage[id])
  if (preferredCoverImage) {
    images.sort((left, right) => Number(right.sha256 === preferredCoverImage) - Number(left.sha256 === preferredCoverImage))
  }

  return {
    id,
    title: cleanText(fields.title || fields.rawTitle, `Product ${id}`),
    manufacturer: cleanText(fields.manufacturer || fields.rawManufacturer, 'unknown'),
    classification: ['likely_scale', 'likely_prize', 'other', 'unknown'].includes(classification)
      ? classification
      : 'unknown',
    category: cleanText(fields.category || fields.rawCategory, 'unknown'),
    scale: cleanText(fields.scale || fields.rawScale, 'unknown'),
    sourceUrl: cleanText(fields.sourceUrl || fields.url || fields.canonicalUrl),
    status: cleanText(fields.status || fields.releaseStatus || fields.rawReleaseStatus, 'unknown'),
    images,
    excluded: preferences.excludedProductIds.includes(id),
    note: cleanText(preferences.manualNote[id]),
    preferredCoverImage,
  }
}

function summarize(products, failures) {
  const buckets = { likely_scale: 0, likely_prize: 0, unknown: 0, other: 0 }
  let images = 0
  for (const product of products) {
    buckets[product.classification] += 1
    images += product.images.length
  }
  return { products: products.length, images, failures: failures.length, ...buckets }
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
  const preferences = normalizePreferences(
    await readJson(path.join(root, 'preferences.json'), DEFAULT_PREFERENCES),
  )
  const runIds = await listRunIds(root)
  const runId = requestedRunId || runIds[0] || null
  if (!runId || !runIds.includes(runId)) return null

  const runDirectory = path.join(root, 'runs', runId)
  const run = (await readJson(path.join(runDirectory, 'run.json'), {}) ) || {}
  const imageIndex =
    (await readJson(path.join(root, 'image-index.json'), { objects: {} })) || { objects: {} }
  const productDocument = await readJson(path.join(runDirectory, 'products.json'), [])
  const rawProducts = asArray(productDocument?.products ?? productDocument)
  const resolvedProducts = await Promise.all(rawProducts.map((product) => loadProductReference(root, product)))
  const products = resolvedProducts
    .map((product) => normalizeProduct(product, preferences, imageIndex.objects || {}))
    .filter(Boolean)
  const failureDocument = await readJson(path.join(runDirectory, 'failures.json'), [])
  const failures = asArray(failureDocument?.failures ?? failureDocument)

  return {
    runId,
    query: cleanText(run.query || run.characterName || run.input?.query, 'Unknown character'),
    querySlug: normalizeQuery(run.query || run.characterName || run.input?.query),
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
  const normalized = normalizeQuery(query)
  for (const runId of await listRunIds(root)) {
    const gallery = await loadRunGallery(root, runId)
    if (gallery && gallery.querySlug === normalized) return gallery
  }
  return null
}

export async function listRecentRuns(root, limit = 10) {
  const output = []
  for (const runId of (await listRunIds(root)).slice(0, limit)) {
    const run = await readJson(path.join(root, 'runs', runId, 'run.json'), {})
    output.push({
      runId,
      query: cleanText(run?.query || run?.characterName || run?.input?.query, 'Unknown character'),
      status: cleanText(run?.status, 'unknown'),
      startedAt: run?.startedAt || null,
      completedAt: run?.completedAt || run?.updatedAt || null,
    })
  }
  return output
}

export async function savePreferences(root, value) {
  const preferences = normalizePreferences(value)
  await fs.mkdir(root, { recursive: true })
  const target = path.join(root, 'preferences.json')
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
