import { decodeHtml, parseHeightMm, parseScale } from '../text.js'
import { record } from '../records.js'

export const JAPAN_FIGURE_FAMILY = 'japan-figure'
const UCP_URL = 'https://japan-figure.com/api/ucp/mcp'
const UCP_PROFILE = 'https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json'

function manufacturer(product, description) {
  const brand = (product.tags ?? []).map(String).find((tag) => /^brand_/iu.test(tag))
  if (brand) return brand.replace(/^brand_/iu, '').trim()
  const labelled = description.match(/\bManufacturer:\s*([^•]+?)(?=\s*•|\s+(?:Release Date|Recommended Age|Country of origin):|$)/iu)?.[1]?.trim()
  if (labelled) return labelled
  const corpus = `${product.title ?? ''} ${description}`.toLocaleLowerCase('en-US')
  return [
    ['good smile company', 'Good Smile Company'], ['bandai spirits', 'Bandai Spirits'],
    ['banpresto', 'Banpresto'], ['kadokawa', 'KADOKAWA'], ['furyu', 'FuRyu'],
    ['taito', 'Taito'], ['sega', 'SEGA'], ['freeing', 'FREEing'],
  ].find(([needle]) => corpus.includes(needle))?.[1] ?? ''
}

export function parseJapanFigureProduct(product, profile) {
  const description = decodeHtml(product.description?.html ?? '')
  const tags = (product.tags ?? []).map(String)
  const images = (product.media ?? []).filter((item) => item?.type === 'image' && item?.url).map((item) => item.url)
  const sourceId = String(product.id ?? '').split('/').at(-1)
  const scale = parseScale(`${product.title ?? ''} ${description}`)
  const prize = [product.title, ...tags, ...(product.collections ?? []).map((item) => item?.title)].some((value) => /prize/iu.test(String(value ?? '')))
  return record({
    sourceFamily: JAPAN_FIGURE_FAMILY,
    sourceId,
    sourceUrl: product.url,
    character: profile,
    title: product.title,
    series: profile.seriesAliases[0],
    manufacturer: manufacturer(product, description),
    category: prize ? 'Prize' : (scale ? 'Scale Figure' : 'General'),
    description,
    imageUrls: images,
    tags,
    productType: 'Figure',
    scale,
    heightMm: parseHeightMm(description),
    available: (product.variants ?? []).some((variant) => Boolean(variant?.availability?.available)),
  })
}

export async function collectJapanFigure(fetcher, profile) {
  const response = await fetcher.postJson(UCP_URL, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'search_catalog',
      arguments: {
        meta: { 'ucp-agent': { profile: UCP_PROFILE } },
        catalog: { query: profile.japanFigureQuery, filters: { available: false }, pagination: { limit: 250 } },
      },
    },
  })
  if (response?.result?.isError) throw new Error('Japan Figure UCP returned an error result.')
  const products = response?.result?.structuredContent?.products ?? []
  return { source: JAPAN_FIGURE_FAMILY, raw: products.length, records: products.map((product) => parseJapanFigureProduct(product, profile)) }
}
