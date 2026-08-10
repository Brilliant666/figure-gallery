import { decodeHtml, parseHeightMm, parseScale } from '../text.js'
import { record } from '../records.js'

export const SOLARIS_FAMILY = 'solaris'

function normalizeVendor(value) {
  const cleaned = String(value ?? '').normalize('NFKC').replace(/\s+as\s+manufacturer$/iu, '').trim()
  if (/good smile arts shanghai/iu.test(cleaned)) return 'Good Smile Arts Shanghai'
  const aliases = new Map([
    ['furyu', 'FuRyu'],
    ['freeing', 'FREEing'],
    ['sega', 'SEGA'],
    ['taito', 'Taito'],
    ['bandai spirits', 'Bandai Spirits'],
    ['good smile company', 'Good Smile Company'],
  ])
  return aliases.get(cleaned.toLocaleLowerCase('en-US')) ?? cleaned
}

function categoryFromTags(tags) {
  const values = tags.map((tag) => String(tag).replace(/^meta-(?:figure|figures|type)-/iu, ''))
  return ['Nendoroid', 'Figma', 'Action', 'Prize', 'Limited Editions', 'General', 'Figure']
    .find((preferred) => values.some((value) => value.toLocaleLowerCase('en-US') === preferred.toLocaleLowerCase('en-US'))) ?? 'Figure'
}

export function parseSolarisProduct(product, profile) {
  const tags = (product.tags ?? []).map(String)
  const description = decodeHtml(product.body_html ?? '')
  const images = (product.images ?? []).map((image) => image?.src).filter(Boolean)
  const handle = String(product.handle ?? '')
  const sourceId = String(product.id ?? handle)
  return record({
    sourceFamily: SOLARIS_FAMILY,
    sourceId,
    sourceUrl: `https://solarisjapan.com/products/${handle}`,
    character: profile,
    title: product.title,
    series: profile.seriesAliases[0],
    manufacturer: normalizeVendor(product.vendor),
    category: categoryFromTags(tags),
    description,
    imageUrls: images,
    tags,
    productType: product.product_type,
    scale: parseScale(`${product.title} ${description}`),
    heightMm: parseHeightMm(description),
    available: (product.variants ?? []).some((variant) => Boolean(variant?.available)),
    sourceUpdatedAt: product.updated_at ?? null,
  })
}

export async function collectSolaris(fetcher, profile, { maxPages = 20 } = {}) {
  const output = []
  const seen = new Set()
  let raw = 0
  for (const handle of profile.solarisCollectionHandles) {
    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL(`https://solarisjapan.com/collections/${handle}/products.json`)
      url.searchParams.set('limit', '250')
      url.searchParams.set('page', String(page))
      const payload = await fetcher.json(url)
      const products = Array.isArray(payload?.products) ? payload.products : []
      raw += products.length
      for (const product of products) {
        const id = String(product?.id ?? '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        output.push(parseSolarisProduct(product, profile))
      }
      if (products.length < 250) break
    }
  }
  return { source: SOLARIS_FAMILY, raw, records: output }
}
