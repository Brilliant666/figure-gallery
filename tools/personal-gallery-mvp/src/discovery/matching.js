import { matchesCharacterText, matchesCharacterWork, validateCharacterConfig } from '../characters/registry.js'
import { normalizeOfficialPageUrl, officialUrlIdentity } from '../parsers/official-urls.js'
import { normalizeProductTitle } from './hpoi-index.js'

function cleanManufacturer(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

function ngrams(value, size = 3) {
  const compact = normalizeProductTitle(value).replace(/\s+/gu, '')
  if (!compact) return new Set()
  if (compact.length <= size) return new Set([compact])
  return new Set(Array.from({ length: compact.length - size + 1 }, (_, index) => compact.slice(index, index + size)))
}

function overlap(left, right) {
  const a = ngrams(left)
  const b = ngrams(right)
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter((value) => b.has(value)).length
  return intersection / Math.max(a.size, b.size)
}

function cleanProductId(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US') || null
}

function productOfficialIds(product) {
  return new Set([
    product?.officialProductId,
    product?.fields?.officialProductId,
    product?.identity?.sourceItemId,
  ].map(cleanProductId).filter(Boolean))
}

function candidateOfficialIds(candidate) {
  return new Set([
    candidate?.officialProductIdHint,
    ...(candidate?.resolutionEvidence || []).map((entry) => entry?.officialProductId),
  ].map(cleanProductId).filter(Boolean))
}

function setIntersects(left, right) {
  return [...left].some((value) => right.has(value))
}

function productVariantText(product) {
  return product?.design || product?.variant || product?.fields?.design || product?.fields?.variant || product?.title || product?.fields?.rawTitle
}

function hasDistinctiveCandidateIdentity(candidate) {
  const variant = normalizeProductTitle(candidate?.variantHint)
  if (variant.replace(/\s+/gu, '').length >= 3) return true
  const manufacturer = cleanManufacturer(candidate?.manufacturerHint)
  const scale = String(candidate?.scaleHint || '').trim()
  return Boolean(manufacturer && scale)
}

export function productMatchScore(candidate, product) {
  const candidateTitle = normalizeProductTitle(candidate?.titleHint)
  const productTitle = normalizeProductTitle(product?.title || product?.fields?.rawTitle || product?.fields?.title)
  if (!candidateTitle || !productTitle) return 0
  const containment = candidateTitle.includes(productTitle) || productTitle.includes(candidateTitle)
  let score = containment && Math.min(candidateTitle.length, productTitle.length) >= 6 ? 0.82 : overlap(candidateTitle, productTitle) * 0.78
  const candidateManufacturer = cleanManufacturer(candidate?.manufacturerHint)
  const productManufacturer = cleanManufacturer(product?.manufacturer || product?.fields?.rawManufacturer || product?.fields?.manufacturer)
  if (candidateManufacturer && productManufacturer) {
    if (candidateManufacturer === productManufacturer || candidateManufacturer.includes(productManufacturer) || productManufacturer.includes(candidateManufacturer)) score += 0.12
    else score -= 0.08
  }
  const candidateScale = String(candidate?.scaleHint || '').replace(/\s+/gu, '')
  const productScale = String(product?.scale || product?.fields?.rawScale || product?.fields?.scale || '').replace(/\s+/gu, '')
  if (candidateScale && productScale && productScale !== 'unknown') score += candidateScale === productScale ? 0.06 : -0.08
  const candidateVariant = normalizeProductTitle(candidate?.variantHint)
  const productVariant = normalizeProductTitle(productVariantText(product))
  if (candidateVariant && productVariant) {
    const variantOverlap = overlap(candidateVariant, productVariant)
    if (productVariant.includes(candidateVariant) || variantOverlap >= 0.72) score += 0.14
    else if (candidateVariant.replace(/\s+/gu, '').length >= 5) score -= 0.04
  }
  return Math.max(0, Math.min(1, score))
}

export function matchCandidateToProducts(candidate, products = []) {
  const evidenceUrls = (candidate?.resolutionEvidence || []).map((entry) => entry?.officialUrl).filter(Boolean)
  const evidenceIdentities = new Set(evidenceUrls.map(officialUrlIdentity).filter(Boolean))
  for (const product of products) {
    const identity = officialUrlIdentity(product?.sourceUrl || product?.fields?.sourceUrl)
    if (identity && evidenceIdentities.has(identity)) {
      return { kind: 'exact_existing', score: 1, productId: product.id || product.productKey }
    }
  }
  const evidenceProductIds = candidateOfficialIds(candidate)
  if (evidenceProductIds.size) {
    for (const product of products) {
      if (setIntersects(evidenceProductIds, productOfficialIds(product))) {
        return { kind: 'exact_existing', score: 1, productId: product.id || product.productKey }
      }
    }
  }
  if (!hasDistinctiveCandidateIdentity(candidate)) {
    return { kind: 'ambiguous', score: 0, productId: null }
  }
  const ranked = products
    .map((product) => ({ product, score: productMatchScore(candidate, product) }))
    .sort((left, right) => right.score - left.score)
  const best = ranked[0]
  if (!best || best.score < 0.68) {
    return {
      kind: hasDistinctiveCandidateIdentity(candidate) ? 'new_target' : 'ambiguous',
      score: best?.score || 0,
      productId: null,
    }
  }
  const runnerUp = ranked[1]
  if (runnerUp && best.score < 0.88 && best.score - runnerUp.score < 0.05) {
    return { kind: 'ambiguous', score: best.score, productId: null }
  }
  return {
    kind: best.score >= 0.88 ? 'exact_existing' : 'probable_existing',
    score: best.score,
    productId: best.product.id || best.product.productKey,
  }
}

const MANUFACTURER_DOMAINS = new Map([
  ['alter', 'alter-web.jp'],
  ['apex', 'apex-toys.com'],
  ['freeing', 'goodsmile.com'],
  ['goodsmileartsshanghai', 'goodsmile.com'],
  ['goodsmilecompany', 'goodsmile.com'],
  ['kadokawa', 'goodsmile.com'],
  ['phatcompany', 'goodsmile.com'],
  ['wonderfulworks', 'goodsmile.com'],
])

export function buildOfficialResolutionQueries(candidate, characterConfig, { maxQueries = 3 } = {}) {
  const character = validateCharacterConfig(characterConfig)
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 5) throw new Error('Official resolution query limit must be from 1 through 5.')
  const title = String(candidate?.titleHint || '').replace(/\s*[-|｜:]?\s*Hpoi.*$/iu, '').replace(/\s+/gu, ' ').trim()
  const manufacturer = String(candidate?.manufacturerHint || '').trim()
  const alias = character.aliases.find((value) => title.includes(value)) || character.aliases[0]
  const work = character.workNames.find((value) => `${title} ${candidate?.snippetHint || ''}`.includes(value)) || character.workNames[0]
  const domain = MANUFACTURER_DOMAINS.get(cleanManufacturer(manufacturer))
  const output = []
  const add = (value) => {
    const query = String(value || '').replace(/\s+/gu, ' ').trim()
    if (query && !output.includes(query) && output.length < maxQueries) output.push(query)
  }
  if (domain) add(`site:${domain} "${title}"`)
  add(`"${title}" "${manufacturer || alias}" official`)
  add(`"${alias}" "${work}" "${manufacturer || title}" figure official`)
  return output
}

export function rankOfficialResolution(candidate, characterConfig, searchResults = []) {
  const character = validateCharacterConfig(characterConfig)
  return searchResults
    .map((result) => {
      const text = `${result?.title || ''} ${result?.description || ''}`
      const characterEvidence = matchesCharacterText(text, character)
      const workEvidence = matchesCharacterWork(text, character)
      const titleScore = productMatchScore(candidate, {
        title: result?.title,
        manufacturer: candidate?.manufacturerHint,
        scale: candidate?.scaleHint,
      })
      const score = titleScore + (characterEvidence ? 0.08 : 0) + (workEvidence ? 0.05 : 0)
      const officialUrl = normalizeOfficialPageUrl(result?.url || result?.sourceUrl)
      return { ...result, officialUrl, score: Math.min(1, score), characterEvidence, workEvidence }
    })
    .filter((result) => result.officialUrl && result.characterEvidence && result.score >= 0.64)
    .sort((left, right) => right.score - left.score)
}
