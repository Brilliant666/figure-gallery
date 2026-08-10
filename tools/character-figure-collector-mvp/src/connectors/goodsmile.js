import { anchors, classText, detailPairs, heading, imageSources } from '../html.js'
import { absoluteUrl, clean, containsTerm, parseHeightMm, parseScale, unique } from '../text.js'
import { matchesCharacter, matchesSeries } from '../profiles.js'
import { record } from '../records.js'

export const GOODSMILE_FAMILY = 'goodsmile'
const LEGACY_SEARCH = 'https://www.goodsmile.info/en/products/search'

function productId(value) {
  return String(value).match(/\/product\/(\d+)/u)?.[1] ?? new URL(value).pathname
}

function canonical(value) {
  const url = new URL(value)
  const id = productId(value)
  return /^\d+$/u.test(id) ? `https://${url.hostname}/en/product/${id}` : url.toString().split('#')[0]
}

function parseProduct(html, sourceUrl, profile, { legacy = false } = {}) {
  const details = detailPairs(html)
  const title = clean(details['Product Name'] || heading(html, legacy ? '' : 'product-name'))
  const description = clean(details.Specifications)
  const id = productId(sourceUrl)
  const imageUrls = imageSources(html, sourceUrl, (url, attributes) =>
    legacy ? /itemImg/iu.test(attributes) : url.includes(`/product/image/${id}/`),
  )
  const series = clean(details.Series)
  return record({
    sourceFamily: GOODSMILE_FAMILY,
    sourceId: id,
    sourceUrl: canonical(sourceUrl),
    character: profile,
    title,
    series,
    manufacturer: details.Manufacturer,
    category: details.Category || 'Figure',
    description,
    imageUrls,
    release: details['Release Info'] || details['Release Date'],
    scale: parseScale(description),
    heightMm: parseHeightMm(description),
  })
}

export function parseGoodSmileCurrent(html, sourceUrl, profile) {
  const parsed = parseProduct(html, sourceUrl, profile)
  const related = anchors(html, sourceUrl)
    .filter((link) => /\/en\/product\/\d+/u.test(link.url))
    .filter((link) => matchesCharacter(link.label, profile))
    .map((link) => canonical(link.url))
    .filter((url) => productId(url) !== productId(sourceUrl))
  return { record: parsed, related: unique(related) }
}

export function parseGoodSmileLegacy(html, sourceUrl, profile) {
  return parseProduct(html, sourceUrl, profile, { legacy: true })
}

export function parseLegacySearch(html, sourceUrl, profile) {
  const links = anchors(html, sourceUrl)
    .filter((link) => /\/en\/product\/\d+/u.test(link.url))
    .filter((link) => matchesCharacter(link.label, profile))
    .map((link) => canonical(link.url))
  const paginationText = classText(html, 'pagination')
  return { links: unique(links), hasNext: paginationText.includes('»') || /rel=["']next["']/iu.test(html) }
}

export async function collectGoodSmile(fetcher, profile, { includeLegacy = false, maxLegacyPages = 20, maxCurrentPages = 40 } = {}) {
  const records = []
  const seen = new Set()
  let raw = 0

  if (includeLegacy && profile.legacyQuery) {
    for (let page = 1; page <= maxLegacyPages; page += 1) {
      const url = new URL(LEGACY_SEARCH)
      url.searchParams.set('search[query]', profile.legacyQuery)
      url.searchParams.set('search[adult]', '0')
      url.searchParams.set('page', String(page))
      const result = parseLegacySearch(await fetcher.text(url), url, profile)
      for (const productUrl of result.links) {
        if (seen.has(productUrl)) continue
        seen.add(productUrl)
        const parsed = parseGoodSmileLegacy(await fetcher.text(productUrl), productUrl, profile)
        raw += 1
        if (matchesCharacter(`${parsed.title} ${parsed.description}`, profile) && matchesSeries(`${parsed.series} ${parsed.description}`, profile)) records.push(parsed)
      }
      if (!result.hasNext || result.links.length === 0) break
    }
  }

  const queue = [...profile.goodSmileSeeds]
  let currentPages = 0
  while (queue.length && currentPages < maxCurrentPages) {
    const productUrl = canonical(queue.shift())
    if (seen.has(productUrl)) continue
    seen.add(productUrl)
    currentPages += 1
    const result = parseGoodSmileCurrent(await fetcher.text(productUrl), productUrl, profile)
    raw += 1
    const corpus = `${result.record.title} ${result.record.series} ${result.record.description}`
    if (matchesCharacter(corpus, profile) && matchesSeries(corpus, profile)) {
      records.push(result.record)
      for (const related of result.related) if (!seen.has(related) && queue.length < maxCurrentPages) queue.push(absoluteUrl(productUrl, related))
    }
  }
  return { source: GOODSMILE_FAMILY, raw, records }
}
