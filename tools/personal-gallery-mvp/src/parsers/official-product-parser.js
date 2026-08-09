import { load } from 'cheerio'

import {
  cleanText,
  firstAttribute,
  parseJsonLdDocuments,
} from './common.js'
import { classifyProduct } from './product-parser.js'
import { normalizeImageUrl } from './urls.js'
import {
  canonicalOfficialDomain,
  isAllowedOfficialProductUrl,
  isOfficialDistributorDomain,
  normalizeOfficialPageUrl,
  officialUrlIdentity,
} from './official-urls.js'

export const OFFICIAL_PRODUCT_PARSER_VERSION = 'official-deterministic-v1'

const CHESHIRE = /(?:\bcheshire\b|チェシャー|柴郡)/iu
const AZUR_LANE = /(?:\bazur\s+lane\b|アズールレーン|碧蓝航线|碧藍航線)/iu
const RELATED_SELECTOR = [
  '[data-related-products]',
  '.related',
  '.related-products',
  '.recommend',
  '.recommended',
  '.recommendations',
  '.product-recommend',
  '.recently-viewed',
  'aside',
  'footer',
  'nav',
].join(',')
const GALLERY_SELECTORS = [
  '[data-product-gallery]',
  '.product-gallery',
  '.product-image-gallery',
  '.product-images',
  '.product-main-image',
  '.swiper.product-gallery',
  '.item_image',
  '.item-images',
  '.item_photo',
  '.item-photo',
  '.w-detailcontent img.fullScreen',
  '[data-fancybox="product"]',
  '[data-lightbox="product"]',
]
const IMAGE_REJECTION = /(?:^|[\/_\-.])(?:avatar|badge|banner|cart|favicon|icon|logo|payment|recommend|related|sprite|tracking|pixel)(?:[\/_\-.]|$)/iu
const SENSITIVE_IMAGE_PARAMETER = /^(?:access_?token|api_?key|apikey|auth|authorization|cookie|password|secret|session|session_?id|sid|token)$/iu

export class OfficialPageValidationError extends Error {
  constructor(message, { code = 'official_page_not_authentic', evidence = null } = {}) {
    super(message)
    this.name = 'OfficialPageValidationError'
    this.code = code
    this.evidence = evidence
  }
}

function normalizeLabel(value) {
  return (cleanText(value) || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[：:\s]/g, '')
}

function addField(target, label, value) {
  const key = normalizeLabel(label)
  const cleaned = cleanText(value)
  if (key && cleaned && !target.has(key)) target.set(key, cleaned)
}

function collectFields($) {
  const fields = new Map()
  $('dt').each((_index, node) => addField(fields, $(node).text(), $(node).next('dd').text()))
  $('tr').each((_index, node) => {
    const cells = $(node).find('th,td')
    if (cells.length >= 2) addField(fields, cells.eq(0).text(), cells.eq(1).text())
  })
  $('[data-field-label], [data-label]').each((_index, node) => {
    const item = $(node)
    addField(
      fields,
      item.attr('data-field-label') || item.attr('data-label'),
      item.attr('data-field-value') || item.attr('data-value') || item.text(),
    )
  })
  $('.spec-item, .product-spec-item, .item_data li').each((_index, node) => {
    const item = $(node)
    const label = item.find('.label, .name, strong, dt').first().text()
    const value = item.find('.value, .content, span, dd').last().text()
    addField(fields, label, value)
  })
  return fields
}

function field(fields, aliases) {
  for (const alias of aliases) {
    const value = fields.get(normalizeLabel(alias))
    if (value) return value
  }
  return null
}

function schemaValue(value) {
  if (typeof value === 'string' || typeof value === 'number') return cleanText(value)
  if (Array.isArray(value)) {
    for (const child of value) {
      const result = schemaValue(child)
      if (result) return result
    }
  }
  if (value && typeof value === 'object') {
    return cleanText(value.name) || cleanText(value.value) || cleanText(value.text)
  }
  return null
}

function jsonLdTypeIncludes(value, wanted) {
  const types = Array.isArray(value?.['@type']) ? value['@type'] : [value?.['@type']]
  return types.some((type) => String(type || '').toLocaleLowerCase('en-US') === wanted.toLocaleLowerCase('en-US'))
}

function collectJsonLdByType(value, wanted, output = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return output
  seen.add(value)
  if (jsonLdTypeIncludes(value, wanted)) {
    output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdByType(item, wanted, output, seen)
    return output
  }
  for (const item of Object.values(value)) collectJsonLdByType(item, wanted, output, seen)
  return output
}

function comparableText(value) {
  return (cleanText(value) || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

function titleMatchesProduct(title, product) {
  const left = comparableText(title)
  const right = comparableText(schemaValue(product?.name))
  if (!left || !right) return false
  if (left === right) return true
  return Math.min(left.length, right.length) >= 8 && (left.includes(right) || right.includes(left))
}

function structuredUrlValues(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(structuredUrlValues)
  if (value && typeof value === 'object') {
    return [value.url, value['@id'], value.contentUrl].flatMap(structuredUrlValues)
  }
  return []
}

function selectStructuredProduct(documents, { pageUrl, title }) {
  const products = documents.flatMap((document) => collectJsonLdByType(document, 'Product'))
  if (products.length === 0) return null
  const pageIdentity = officialUrlIdentity(pageUrl)
  const urlMatches = products.filter((product) =>
    [product.url, product['@id'], product.mainEntityOfPage]
      .flatMap(structuredUrlValues)
      .map((value) => officialUrlIdentity(value, pageUrl))
      .some((identity) => identity && identity === pageIdentity),
  )
  const candidates = urlMatches.length ? urlMatches : products
  const titleMatch = candidates.find((product) => titleMatchesProduct(title, product))
  if (titleMatch) return titleMatch
  if (urlMatches.length) return urlMatches[0]
  // A visible current-page title is stronger than an unrelated lone Product
  // block (which is commonly emitted for recommendations). Only use a lone
  // Product as a title fallback when the page itself exposes no title.
  if (cleanText(title)) return null
  return products.length === 1 ? products[0] : null
}

function cleanId(value) {
  const result = cleanText(value)
  return result && /^[\p{Letter}\p{Number}._-]{1,128}$/u.test(result) ? result : null
}

function sourceIdFromUrl(sourceUrl, sourceDomain) {
  const parsed = new URL(sourceUrl)
  if (sourceDomain === 'amiami.jp') return cleanId(parsed.searchParams.get('gcode'))
  if (sourceDomain === 'apex-toys.com') return cleanId(/\/productinfo\/(\d+)\.html$/iu.exec(parsed.pathname)?.[1])
  return null
}

function firstTextMatch(value, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(value || '')
    if (match?.[1]) return cleanText(match[1])
  }
  return null
}

function primaryDocument(rawHtml) {
  const full = load(rawHtml || '<html></html>')
  const body = full('body').clone()
  body.find(RELATED_SELECTOR).remove()
  return { full, primary: load(`<main>${body.html() || ''}</main>`) }
}

function searchableDocumentText($) {
  const chunks = []
  const visit = (node) => {
    if (node?.type === 'text') {
      chunks.push(node.data)
      return
    }
    for (const child of node?.children || []) visit(child)
  }
  for (const body of $('body').toArray()) visit(body)
  return cleanText(chunks.join(' ')) || ''
}

function normalizedImage(value, pageUrl) {
  const normalized = normalizeImageUrl(value, pageUrl)
  if (!normalized) return null
  const parsed = new URL(normalized)
  if (parsed.protocol !== 'https:' || [...parsed.searchParams.keys()].some((key) => SENSITIVE_IMAGE_PARAMETER.test(key))) return null
  let path = parsed.pathname
  try { path = decodeURIComponent(path) } catch { /* filtering may use the encoded path */ }
  return IMAGE_REJECTION.test(path) ? null : normalized
}

function imageValues(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(imageValues)
  if (value && typeof value === 'object') {
    return imageValues(value.url || value.contentUrl || value.thumbnailUrl)
  }
  return []
}

function collectGalleryImages($, pageUrl, firecrawlImages = [], structuredProduct = null) {
  const found = []
  const add = (value, kind, selector) => {
    const url = normalizedImage(value, pageUrl)
    if (!url || found.some((image) => image.url === url)) return
    found.push({ kind, sourcePageUrl: pageUrl, sourceExists: true, sourceSelector: selector, url })
  }

  add(firstAttribute($, ['meta[property="og:image"]'], 'content'), 'homepage', 'meta:og:image')
  for (const value of imageValues(structuredProduct?.image)) add(value, 'product', 'jsonld:Product.image')
  for (const selector of GALLERY_SELECTORS) {
    $(selector).each((_index, root) => {
      const item = $(root)
      if (item.closest(RELATED_SELECTOR).length) return
      if (item.is('a')) add(item.attr('href'), 'product', selector)
      if (item.is('img')) {
        add(item.attr('src') || item.attr('data-src') || item.attr('data-original'), 'product', selector)
      }
      item.find('a[href]').each((_linkIndex, link) => add($(link).attr('href'), 'product', `${selector} a`))
      item.find('img').each((_imageIndex, image) => {
        const imageElement = $(image)
        add(
          imageElement.attr('src') || imageElement.attr('data-src') || imageElement.attr('data-original'),
          'product',
          `${selector} img`,
        )
        const srcset = cleanText(imageElement.attr('srcset'))
        if (srcset) {
          for (const entry of srcset.split(',')) add(entry.trim().split(/\s+/)[0], 'product', `${selector} srcset`)
        }
      })
    })
  }

  const firecrawlSet = new Set(
    (firecrawlImages || [])
      .map((value) => normalizedImage(typeof value === 'string' ? value : value?.url, pageUrl))
      .filter(Boolean),
  )
  $('main, article, [data-product-detail], [itemtype*="Product"]').each((_rootIndex, root) => {
    $(root).find('a[href], img').each((_index, node) => {
      const item = $(node)
      if (item.closest(RELATED_SELECTOR).length) return
      const candidate = item.is('a')
        ? item.attr('href')
        : item.attr('src') || item.attr('data-src') || item.attr('data-original')
      const url = normalizedImage(candidate, pageUrl)
      if (!url) return
      const marker = [
        item.attr('class'),
        item.attr('id'),
        item.parent().attr('class'),
        item.parent().attr('id'),
      ].filter(Boolean).join(' ')
      const alt = `${item.attr('alt') || ''} ${item.attr('title') || ''}`
      if (/(?:gallery|image|photo|picture|slide|swiper|thumb|visual|product)/iu.test(marker) || CHESHIRE.test(alt) || firecrawlSet.has(url)) {
        add(url, 'product', 'primary-product-content')
      }
    })
  })

  const corroborated = new Set(found.map((image) => image.url))
  for (const value of firecrawlImages || []) {
    const url = normalizedImage(typeof value === 'string' ? value : value?.url, pageUrl)
    if (url && corroborated.has(url)) add(url, 'product', 'firecrawl:corroborated')
  }
  return found.slice(0, 10)
}

function descriptionFrom($, structuredProduct) {
  return cleanText($('[itemprop="description"], .product-description, .item_description, .description').first().text())
    || schemaValue(structuredProduct?.description)
    || firstAttribute($, ['meta[name="description"]'], 'content')
}

function priceFrom(fields, structuredProduct) {
  const explicit = field(fields, ['price', '価格', '售价', '售價'])
  if (explicit) return explicit
  const price = schemaValue(structuredProduct?.offers?.price)
  const currency = schemaValue(structuredProduct?.offers?.priceCurrency)
  return cleanText([price, currency].filter(Boolean).join(' '))
}

function sameOfficialSite(left, right) {
  return canonicalOfficialDomain(new URL(left).hostname) === canonicalOfficialDomain(new URL(right).hostname)
}

export function validateOfficialProductPage({ title, primaryText, series, manufacturerEvidence, specificationEvidence, descriptionEvidence }) {
  const evidence = {
    characterMatched: CHESHIRE.test(title || ''),
    seriesMatched: AZUR_LANE.test(`${series || ''} ${primaryText || ''}`),
    manufacturerEvidence: Boolean(manufacturerEvidence),
    specificationEvidence: Boolean(specificationEvidence),
    descriptionEvidence: Boolean(descriptionEvidence),
  }
  const evidenceCount = [evidence.manufacturerEvidence, evidence.specificationEvidence, evidence.descriptionEvidence]
    .filter(Boolean).length
  const accepted = evidence.characterMatched && evidence.seriesMatched && evidenceCount >= 2
  return {
    accepted,
    evidenceCount,
    evidence,
    rejectedReason: accepted
      ? null
      : !evidence.characterMatched
        ? 'character_not_in_primary_product_title'
        : !evidence.seriesMatched
          ? 'series_not_confirmed'
          : 'insufficient_official_product_evidence',
  }
}

export function parseOfficialProductPage({
  rawHtml,
  url,
  images = [],
  firecrawlProduct = null,
  discoveryQuery = null,
  discoveryMethod = 'firecrawl_search',
  parsedAt = new Date().toISOString(),
} = {}) {
  const requestedUrl = normalizeOfficialPageUrl(url)
  if (!requestedUrl || !isAllowedOfficialProductUrl(requestedUrl)) {
    throw new OfficialPageValidationError('Product URL is outside the official source allowlist.', { code: 'official_url_not_allowed' })
  }
  const { full, primary } = primaryDocument(rawHtml)
  const canonicalCandidate = normalizeOfficialPageUrl(
    firstAttribute(full, ['link[rel="canonical"]'], 'href'),
    requestedUrl,
  )
  const sourceUrl = canonicalCandidate && isAllowedOfficialProductUrl(canonicalCandidate) && sameOfficialSite(canonicalCandidate, requestedUrl)
    ? canonicalCandidate
    : requestedUrl
  const sourceDomain = canonicalOfficialDomain(new URL(sourceUrl).hostname)
  const fields = collectFields(primary)
  const jsonLdDocuments = parseJsonLdDocuments(full)
  const visibleTitle = cleanText(primary('h1, [itemprop="name"], .product-title, .item_name').first().text())
    || firstAttribute(full, ['meta[property="og:title"]'], 'content')
    || cleanText(full('title').text())
  const structuredProduct = selectStructuredProduct(jsonLdDocuments, {
    pageUrl: sourceUrl,
    title: visibleTitle,
  })
  const title = visibleTitle || schemaValue(structuredProduct?.name)
  const series = field(fields, ['series', 'work', 'title', '作品名', '作品', '原作', '原作名', '系列'])
    || cleanText(primary('[data-series], .product-series, .item_title').first().text())
  const characterField = field(fields, ['character', '角色', 'キャラクター', 'キャラ名'])
  const knownManufacturer = sourceDomain === 'alter-web.jp'
    ? 'ALTER'
    : sourceDomain === 'apex-toys.com'
      ? 'APEX'
      : null
  const explicitManufacturer = field(fields, [
    'manufacturer',
    'maker',
    'brand',
    'brand name',
    'ブランド名',
    '厂商',
    '製造元',
    'メーカー',
  ])
    || schemaValue(structuredProduct?.brand)
    || schemaValue(firecrawlProduct?.brand)
  const category = field(fields, ['category', 'type', '分类', '類型', '商品形態', '仕様'])
    || schemaValue(structuredProduct?.category)
  const primaryText = searchableDocumentText(primary)
  const scale = field(fields, ['scale', '比例', 'スケール'])
    || firstTextMatch(primaryText, [
      /(?:スケール|scale|比例)[^\p{Number}]{0,20}(1\s*\/\s*\d+)/iu,
      /\b(1\s*\/\s*\d+)\s*(?:scale|スケール|比例)/iu,
    ])?.replace(/\s+/g, '')
  const height = field(fields, ['height', '全高', '尺寸', 'サイズ'])
    || firstTextMatch(primaryText, [
      /(?:全高|高さ|height|サイズ)[^。；;\n]{0,10}((?:約\s*)?\d+(?:\.\d+)?\s*(?:mm|cm))/iu,
    ])
  const releaseDate = field(fields, ['release date', 'release', '発売時期', '発売月', '发售时间', '發售時間'])
    || schemaValue(structuredProduct?.releaseDate)
  const sculptor = field(fields, ['sculptor', '原型', '原型制作', '原型製作'])
  const paintwork = field(fields, ['paintwork', 'coloring', '彩色', '彩色担当'])
  const description = descriptionFrom(primary, structuredProduct)
  const price = priceFrom(fields, structuredProduct)
  const officialProductId = cleanId(
    primary('[data-product-id], [data-sku]').first().attr('data-product-id')
      || primary('[data-sku]').first().attr('data-sku')
      || field(fields, ['product id', 'sku', '商品番号', '品番', 'JAN'])
      || structuredProduct?.sku
      || structuredProduct?.productID
      || structuredProduct?.mpn,
  ) || sourceIdFromUrl(sourceUrl, sourceDomain)
  // Join text nodes explicitly so adjacent HTML elements retain word
  // boundaries (for example, </h1><p>Azur Lane). Cheerio's `.text()`
  // concatenates those nodes without a separator and can otherwise turn a
  // valid series marker into `CheshireAzur Lane`.
  const specificationEvidence = [category, scale, height, releaseDate, price, sculptor, paintwork].some(Boolean)
  const validation = validateOfficialProductPage({
    title,
    primaryText,
    series,
    manufacturerEvidence: explicitManufacturer || knownManufacturer,
    specificationEvidence,
    descriptionEvidence: description && description.length >= 20,
  })
  if (!validation.accepted) {
    throw new OfficialPageValidationError(`Official page rejected: ${validation.rejectedReason}.`, {
      evidence: validation,
    })
  }

  const manufacturer = explicitManufacturer || knownManufacturer
  const distributorSource = isOfficialDistributorDomain(new URL(sourceUrl).hostname)
  const sourceKind = distributorSource ? 'official_distributor' : 'official_manufacturer'
  const distributor = distributorSource ? 'AmiAmi' : null
  const candidateImages = collectGalleryImages(full, sourceUrl, images, structuredProduct)
  const classification = classifyProduct({ title, rawCategory: category, rawScale: scale })
  const character = characterField || (CHESHIRE.test(title || '') ? 'Cheshire' : null)
  const normalizedSeries = series || (AZUR_LANE.test(primaryText) ? 'Azur Lane' : null)
  const needsReview = []
  for (const [name, value] of Object.entries({ officialProductId, manufacturer, scale, releaseDate })) {
    if (!value) needsReview.push(name)
  }
  if (classification.classification === 'unknown') needsReview.push('classification')

  return {
    sourceType: 'official',
    sourceKind,
    sourceDomain,
    discoveryQuery: cleanText(discoveryQuery),
    discoveryMethod: discoveryMethod === 'seed_official_url' ? 'seed_official_url' : 'firecrawl_search',
    officialProductId,
    title,
    character,
    series: normalizedSeries,
    manufacturer,
    distributor,
    category,
    rawCategory: category,
    scale,
    rawScale: scale,
    height,
    releaseDate,
    price,
    sculptor,
    paintwork,
    description,
    sourceUrl,
    homepageImage: candidateImages[0]?.url || null,
    candidateImages,
    imageUrls: candidateImages.map((image) => image.url),
    discoveredImageHosts: [...new Set(candidateImages.map((image) => new URL(image.url).hostname.toLowerCase()))],
    classification: classification.classification,
    excludedReason: classification.excludedReason,
    needsReview: [...new Set(needsReview)],
    parserWarnings: candidateImages.length ? [] : ['official_product_images_missing'],
    authenticity: validation,
    parsedAt,
    parserVersion: OFFICIAL_PRODUCT_PARSER_VERSION,
  }
}
