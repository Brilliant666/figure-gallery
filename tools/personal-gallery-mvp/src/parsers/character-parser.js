import { load } from 'cheerio'

import { cleanText, firstAttribute, firstText, normalizedText } from './common.js'
import {
  extractCharacterId,
  extractProductId,
  isCharacterUrl,
  isProductUrl,
  normalizePageUrl,
} from './urls.js'

function confidenceFor(query, title) {
  const wanted = normalizedText(query)
  const candidate = normalizedText(title)
  if (!wanted || !candidate) return 'low'
  if (candidate === wanted) return 'high'
  if (candidate.includes(wanted) || wanted.includes(candidate)) return 'medium'
  return 'low'
}

function upsertCandidate(target, value) {
  const normalizedUrl = normalizePageUrl(value.url)
  if (!normalizedUrl || !isCharacterUrl(normalizedUrl)) return
  const characterId = extractCharacterId(normalizedUrl)
  const key = characterId || normalizedUrl
  const current = target.get(key)
  if (!current) {
    target.set(key, { ...value, characterId, url: normalizedUrl })
    return
  }
  target.set(key, {
    ...current,
    title: current.title || value.title,
    workName: current.workName || value.workName,
    confidence: ['low', 'medium', 'high'].indexOf(value.confidence) > ['low', 'medium', 'high'].indexOf(current.confidence)
      ? value.confidence
      : current.confidence,
  })
}

export function parseCharacterCandidates({ query, rawHtml = '', links = [], searchResults = [], sourceUrl = 'https://www.hpoi.net/' }) {
  const candidates = new Map()
  const $ = load(rawHtml || '<html></html>')

  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href')
    const url = normalizePageUrl(href, sourceUrl)
    if (!url || !isCharacterUrl(url)) return
    const card = $(element).closest('[data-character-result], .character-item, .search-item, li, article')
    const title = cleanText($(element).attr('title')) || cleanText($(element).text())
    let workName = cleanText(card.attr('data-work'))
    for (const selector of ['.work', '.origin', '.subtitle', '[data-role="work"]']) {
      workName ||= cleanText(card.find(selector).first().text())
    }
    upsertCandidate(candidates, {
      confidence: confidenceFor(query, title),
      title,
      workName,
      url,
    })
  })

  for (const result of searchResults) {
    const url = normalizePageUrl(result?.url)
    if (!url || !isCharacterUrl(url)) continue
    const title = cleanText(result?.title)
    upsertCandidate(candidates, {
      confidence: confidenceFor(query, title),
      title,
      workName: cleanText(result?.workName) || null,
      url,
    })
  }

  for (const value of links) {
    const url = normalizePageUrl(typeof value === 'string' ? value : value?.url, sourceUrl)
    if (!url || !isCharacterUrl(url)) continue
    upsertCandidate(candidates, {
      confidence: 'low',
      title: null,
      workName: null,
      url,
    })
  }

  return [...candidates.values()].sort((left, right) => {
    const rank = { high: 0, medium: 1, low: 2 }
    return rank[left.confidence] - rank[right.confidence] || left.url.localeCompare(right.url)
  })
}

export function resolveCharacterMatch(candidates) {
  if (candidates.length === 0) return { status: 'not_found', candidates: [] }
  const highConfidence = candidates.filter((candidate) => candidate.confidence === 'high')
  if (highConfidence.length === 1 && candidates.length === 1) {
    return { status: 'matched', match: highConfidence[0], candidates }
  }
  return { status: 'disambiguation', candidates }
}

function explicitNextUrl($, pageUrl, characterId) {
  const selectors = [
    'a[rel~="next"]',
    'link[rel~="next"]',
    '.pagination .next a',
    '.pagination a.next',
    'a.next-page',
  ]
  const candidates = []
  for (const selector of selectors) {
    $(selector).each((_index, element) => candidates.push($(element)))
  }
  $('a[href]').each((_index, element) => {
    const text = normalizedText($(element).text())
    if (/^(?:下一页|下页|next|›|»)$/.test(text)) candidates.push($(element))
  })

  for (const element of candidates) {
    const url = normalizePageUrl(element.attr('href'), pageUrl)
    if (url && extractCharacterId(url) === characterId) return url
  }
  return null
}

export function parseCharacterPage({ rawHtml, url, links = [] }) {
  const pageUrl = normalizePageUrl(url)
  if (!pageUrl || !isCharacterUrl(pageUrl)) throw new Error('Character page URL is not an allowed Hpoi character URL.')
  const $ = load(rawHtml || '<html></html>')
  const characterId = extractCharacterId(pageUrl) || cleanText($('[data-character-id]').first().attr('data-character-id'))
  const displayName = firstText($, ['h1', '[data-role="character-name"]', '.character-name'])
    || firstAttribute($, ['meta[property="og:title"]'], 'content')
    || cleanText($('title').text())
  const workName = firstText($, ['[data-role="work"]', '.character-work', '.work-name', '.origin'])

  const productUrls = new Set()
  $('a[href]').each((_index, element) => {
    const candidate = normalizePageUrl($(element).attr('href'), pageUrl)
    if (candidate && isProductUrl(candidate)) productUrls.add(candidate)
  })
  for (const value of links) {
    const candidate = normalizePageUrl(typeof value === 'string' ? value : value?.url, pageUrl)
    if (candidate && isProductUrl(candidate)) productUrls.add(candidate)
  }

  const parserWarnings = []
  if (!characterId) parserWarnings.push('character_id_missing')
  if (!displayName) parserWarnings.push('character_name_missing')
  if (productUrls.size === 0) parserWarnings.push('product_links_missing')

  return {
    characterId,
    displayName,
    workName,
    sourceUrl: pageUrl,
    productUrls: [...productUrls],
    productIds: [...productUrls].map((productUrl) => extractProductId(productUrl)).filter(Boolean),
    nextPageUrl: explicitNextUrl($, pageUrl, characterId),
    parserWarnings,
  }
}
