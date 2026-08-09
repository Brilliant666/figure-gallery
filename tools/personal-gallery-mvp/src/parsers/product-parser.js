import { load } from 'cheerio'

import {
  cleanText,
  findJsonLdByType,
  firstAttribute,
  firstText,
  parseJsonLdDocuments,
  splitNames,
} from './common.js'
import {
  extractProductId,
  isProductUrl,
  normalizeImageUrl,
  normalizePageUrl,
} from './urls.js'

export const HPOI_PRODUCT_PARSER_VERSION = 'hpoi-deterministic-v1'

const IMAGE_REJECTION = /(?:^|[\/_\-.])(avatar|logo|favicon|icon|banner|advert|advertisement|tracking|pixel|loading|spinner|sprite)(?:[\/_\-.]|$)/i
const IMAGE_CONTEXT_REJECTION = /头像|徽标|图标|广告|avatar|logo|favicon|icon|banner|advert|tracking|pixel/i

function normalizeLabel(value) {
  return (cleanText(value) || '').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[：:\s]/g, '')
}

function collectDomFields($) {
  const fields = new Map()
  const put = (label, value) => {
    const key = normalizeLabel(label)
    const cleaned = cleanText(value)
    if (key && cleaned && !fields.has(key)) fields.set(key, cleaned)
  }

  $('.hpoi-infoList-item').each((_index, element) => {
    const item = $(element)
    const label = cleanText(item.find('span, dt, .label, .name').first().text())
    const value = cleanText(item.find('p, dd, .value, .content').first().text())
    put(label, value)
  })
  $('dt').each((_index, element) => {
    const term = $(element)
    put(term.text(), term.next('dd').text())
  })
  $('[data-field-label]').each((_index, element) => {
    const item = $(element)
    put(item.attr('data-field-label'), item.attr('data-field-value') || item.text())
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
  if (typeof value === 'string') return cleanText(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = schemaValue(item)
      if (found) return found
    }
  }
  if (value && typeof value === 'object') {
    return cleanText(value.name) || cleanText(value.value) || cleanText(value.url) || cleanText(value.contentUrl)
  }
  return null
}

function schemaImages(value, target = []) {
  if (typeof value === 'string') target.push(value)
  else if (Array.isArray(value)) value.forEach((item) => schemaImages(item, target))
  else if (value && typeof value === 'object') {
    if (value.url) schemaImages(value.url, target)
    if (value.contentUrl) schemaImages(value.contentUrl, target)
  }
  return target
}

export function classifyProduct({ title, rawCategory, rawScale }) {
  const combined = [title, rawCategory, rawScale].filter(Boolean).join(' ').normalize('NFKC')
  const explicitOther = [
    [/未授权\s*(?:gk|garage\s*kit)|(?:gk|garage\s*kit)\s*未授权/i, 'unauthorized_gk'],
    [/(?:^|\W)(?:gk|garage\s*kit)(?:$|\W)/i, 'garage_kit'],
    [/黏土人|粘土人|nendoroid/i, 'nendoroid'],
    [/可动人偶|可动手办|action\s*figure|\bfigma\b/i, 'action_figure'],
    [/盲盒|blind\s*box/i, 'blind_box'],
    [/\bq[- ]?posket\b|chibi|デフォルメ|q版/i, 'chibi'],
    [/抱き枕|抱枕|dakimakura|body\s*pillow/i, 'body_pillow'],
    [/cosplay|コスプレ|服装|costume|apparel|t-?shirt/i, 'apparel'],
    [/周边|周邊|merchandise|keychain|挂件|掛件|徽章|acrylic\s*stand|アクリルスタンド|カード|\bcard\b/i, 'merchandise'],
    [/非实体|非實體|digital\s*(?:item|product)|电子商品|電子商品|software|\bapp\b/i, 'non_physical'],
  ]
  for (const [pattern, reason] of explicitOther) {
    if (pattern.test(combined)) return { classification: 'other', excludedReason: reason }
  }
  if (/景品|prize/i.test(combined)) return { classification: 'likely_prize', excludedReason: null }
  if (/pop\s*up\s*parade|painted[^\n]{0,40}non[- ]?scale[^\n]{0,40}(?:complete|finished)|(?:non[- ]?scale|ノンスケール)[^\n]{0,40}(?:完成品|フィギュア|figure)/i.test(combined)) {
    return { classification: 'likely_static', excludedReason: null }
  }
  if (/比例|\bscale\b|\b1\s*[:/]\s*\d{1,3}\b/i.test(combined)) {
    return { classification: 'likely_scale', excludedReason: null }
  }
  return { classification: 'unknown', excludedReason: null }
}

function candidateImage(value, pageUrl, context = '') {
  const url = normalizeImageUrl(value, pageUrl)
  if (!url) return null
  let decodedPath = url
  try {
    decodedPath = decodeURIComponent(new URL(url).pathname)
  } catch {
    // URL parsing already succeeded; malformed escapes only affect the optional filter.
  }
  if (IMAGE_REJECTION.test(decodedPath) || IMAGE_CONTEXT_REJECTION.test(context)) return null
  return url
}

function imageCandidates($, pageUrl, structuredProduct, firecrawlProduct, firecrawlImages) {
  const ordered = []
  const add = (value, kind, context = '') => {
    const url = candidateImage(value, pageUrl, context)
    if (url) ordered.push({ kind, sourcePageUrl: pageUrl, sourceExists: true, url })
  }
  const directlyReportedFirecrawlImages = new Set(
    (firecrawlImages || [])
      .map((value) => candidateImage(typeof value === 'string' ? value : value?.url, pageUrl))
      .filter(Boolean),
  )
  const addAuxiliaryProductImage = (value) => {
    const url = candidateImage(value, pageUrl)
    if (url && directlyReportedFirecrawlImages.has(url)) {
      ordered.push({ kind: 'product', sourcePageUrl: pageUrl, sourceExists: true, url })
    }
  }

  add(firstAttribute($, ['meta[property="og:image"]'], 'content'), 'homepage')
  for (const selector of [
    '[data-role="main-image"]',
    '.main-image img',
    'img.main-image',
    '.product-main-image img',
    '[data-product-image="main"]',
  ]) {
    $(selector).each((_index, element) => {
      add($(element).attr('src') || $(element).attr('data-src') || $(element).attr('data-original'), 'homepage', `${$(element).attr('class') || ''} ${$(element).attr('alt') || ''}`)
    })
  }

  for (const value of schemaImages(structuredProduct?.image)) add(value, 'product')
  for (const value of schemaImages(firecrawlProduct?.images || firecrawlProduct?.image)) addAuxiliaryProductImage(value)
  for (const variant of firecrawlProduct?.variants || []) {
    for (const value of schemaImages(variant?.images)) addAuxiliaryProductImage(value)
  }

  $('img').each((_index, element) => {
    const context = `${$(element).attr('class') || ''} ${$(element).attr('alt') || ''} ${$(element).parent().attr('class') || ''}`
    add($(element).attr('src') || $(element).attr('data-src') || $(element).attr('data-original'), 'product', context)
    const srcset = cleanText($(element).attr('srcset'))
    if (srcset) {
      for (const entry of srcset.split(',')) add(entry.trim().split(/\s+/)[0], 'product', context)
    }
  })
  for (const value of firecrawlImages || []) add(typeof value === 'string' ? value : value?.url, 'product')

  const unique = new Map()
  for (const image of ordered) {
    if (!unique.has(image.url)) unique.set(image.url, image)
  }
  return [...unique.values()]
}

export function parseProductPage({
  rawHtml,
  url,
  links = [],
  images = [],
  firecrawlProduct = null,
  parsedAt = new Date().toISOString(),
} = {}) {
  const requestedUrl = normalizePageUrl(url)
  if (!requestedUrl || !isProductUrl(requestedUrl)) throw new Error('Product page URL is not an allowed Hpoi product URL.')
  const $ = load(rawHtml || '<html></html>')
  const canonicalCandidate = normalizePageUrl(firstAttribute($, ['link[rel="canonical"]'], 'href'), requestedUrl)
  const sourceUrl = canonicalCandidate && isProductUrl(canonicalCandidate) ? canonicalCandidate : requestedUrl
  const fields = collectDomFields($)
  const jsonLdDocuments = parseJsonLdDocuments($)
  const structuredProduct = jsonLdDocuments.map((item) => findJsonLdByType(item, 'Product')).find(Boolean) || null
  const hasInvalidJsonLd = jsonLdDocuments.some((item) => item?.__parseError)

  const title = field(fields, ['名称', '中文名'])
    || schemaValue(structuredProduct?.name)
    || cleanText(firecrawlProduct?.title)
    || cleanText(firecrawlProduct?.name)
    || firstAttribute($, ['meta[property="og:title"]'], 'content')
    || cleanText($('title').text())
  const characterText = field(fields, ['角色', '角色名', '登场角色'])
  const workName = field(fields, ['作品', '原作', '出自'])
  const manufacturer = field(fields, ['制作', '厂商', '制造商'])
    || schemaValue(structuredProduct?.brand)
    || schemaValue(firecrawlProduct?.brand)
  const rawCategory = field(fields, ['属性', '分类', '类型'])
    || schemaValue(structuredProduct?.category)
    || schemaValue(firecrawlProduct?.category)
  const rawScale = field(fields, ['比例', '尺寸比例'])
  const releaseStatus = field(fields, ['状态', '发售状态'])
    || schemaValue(structuredProduct?.offers?.availability)
    || schemaValue(firecrawlProduct?.availability)
    || schemaValue(firecrawlProduct?.variants?.[0]?.availability?.text)
  const releaseDate = field(fields, ['出货日', '发售日', '发售时间'])
    || cleanText(structuredProduct?.releaseDate)
  const versionNotes = field(fields, ['版本', '备注', '版本备注'])
  const hpoiProductId = extractProductId(sourceUrl)
    || cleanText($('[data-hobby-id], [data-product-id]').first().attr('data-hobby-id') || $('[data-product-id]').first().attr('data-product-id'))

  const candidateImages = imageCandidates($, sourceUrl, structuredProduct, firecrawlProduct, images)
  const homepageImage = candidateImages.find((image) => image.kind === 'homepage')?.url || candidateImages[0]?.url || null
  const classification = classifyProduct({ title, rawCategory, rawScale })
  const needsReview = []
  const reviewFields = {
    hpoiProductId,
    title,
    characterNames: characterText,
    workName,
    manufacturer,
    rawCategory,
    rawScale,
    releaseStatus,
    releaseDate,
    homepageImage,
  }
  for (const [name, value] of Object.entries(reviewFields)) {
    if (!value) needsReview.push(name)
  }
  if (classification.classification === 'unknown') needsReview.push('classification')

  const parserWarnings = []
  if (hasInvalidJsonLd) parserWarnings.push('invalid_json_ld')
  if (fields.size === 0) parserWarnings.push('known_field_structure_missing')
  if (!hpoiProductId) parserWarnings.push('product_id_missing')
  if (!title) parserWarnings.push('product_title_missing')
  if (candidateImages.length === 0) parserWarnings.push('product_images_missing')

  const discoveredProductLinks = [...new Set(links
    .map((value) => normalizePageUrl(typeof value === 'string' ? value : value?.url, sourceUrl))
    .filter((value) => value && isProductUrl(value)))]

  return {
    sourceType: 'hpoi',
    hpoiProductId,
    sourceUrl,
    title,
    characterNames: splitNames(characterText),
    workName,
    manufacturer,
    rawCategory,
    rawScale,
    releaseStatus,
    releaseDate,
    versionNotes,
    homepageImage,
    candidateImages,
    imageUrls: candidateImages.map((image) => image.url),
    discoveredImageHosts: [...new Set(candidateImages.map((image) => new URL(image.url).hostname.toLowerCase()))],
    discoveredProductLinks,
    classification: classification.classification,
    excludedReason: classification.excludedReason,
    needsReview: [...new Set(needsReview)],
    parserWarnings,
    parsedAt,
    parserVersion: HPOI_PRODUCT_PARSER_VERSION,
  }
}
