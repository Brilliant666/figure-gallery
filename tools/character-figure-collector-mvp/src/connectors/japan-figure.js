import { decodeHtml, parseHeightMm, parseScale } from '../text.js'
import { record } from '../records.js'

export const JAPAN_FIGURE_FAMILY = 'japan-figure'
const UCP_URL = 'https://japan-figure.com/api/ucp/mcp'
const UCP_PROFILE = 'https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json'

export class JapanFigurePaginationError extends Error {
  constructor(code, status, paginationEvidence, message) {
    super(message)
    this.name = 'JapanFigurePaginationError'
    this.code = code
    this.status = status
    this.paginationEvidence = paginationEvidence
  }
}

function paginationEvidence({ status, pagesFetched, recordsFetchedRaw, uniqueSourceRecords, paginationExhausted, terminationReason, finalCursorState }) {
  return {
    status,
    strategy: 'cursor',
    pagesFetched,
    recordsFetchedRaw,
    uniqueSourceRecords,
    duplicateSourceRecords: recordsFetchedRaw - uniqueSourceRecords,
    paginationExhausted,
    terminationReason,
    finalCursorState,
  }
}

function paginationFailure(code, status, state, message) {
  return new JapanFigurePaginationError(code, status, paginationEvidence({
    ...state,
    status,
    paginationExhausted: false,
    terminationReason: code,
  }), message)
}

function parsePage(response) {
  if (response?.result?.isError) throw new Error('Japan Figure UCP returned an error result.')
  const content = response?.result?.structuredContent
  if (!content || !Array.isArray(content.products)) throw new Error('Japan Figure UCP response is missing structuredContent.products.')
  const pagination = content.pagination
  if (!pagination || typeof pagination.has_next_page !== 'boolean') {
    throw new Error('Japan Figure UCP response is missing explicit pagination.has_next_page.')
  }
  const nextCursor = pagination.cursor ?? null
  if (pagination.has_next_page && (typeof nextCursor !== 'string' || !nextCursor.trim())) {
    throw new Error('Japan Figure UCP response has another page but no usable pagination.cursor.')
  }
  return { products: content.products, hasNextPage: pagination.has_next_page, nextCursor: nextCursor?.trim() || null }
}

function requestPayload(profile, { cursor, limit, requestId }) {
  const pagination = { limit }
  if (cursor !== null) pagination.cursor = cursor
  return {
    jsonrpc: '2.0',
    id: requestId,
    method: 'tools/call',
    params: {
      name: 'search_catalog',
      arguments: {
        meta: { 'ucp-agent': { profile: UCP_PROFILE } },
        catalog: { query: profile.japanFigureQuery, filters: { available: false }, pagination },
      },
    },
  }
}

function sourceProductIdentity(product) {
  const id = String(product?.id ?? '').trim()
  if (id) return `id:${id}`
  const url = String(product?.url ?? '').trim()
  return url ? `url:${url}` : null
}

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

export async function collectJapanFigure(fetcher, profile, { maxPages = 20, pageSize = 250 } = {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error('Japan Figure maxPages must be a positive integer.')
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 250) throw new Error('Japan Figure pageSize must be an integer between 1 and 250.')

  const productsByIdentity = new Map()
  const seenCursors = new Set()
  let cursor = null
  let pagesFetched = 0
  let recordsFetchedRaw = 0

  while (pagesFetched < maxPages) {
    const response = await fetcher.postJson(UCP_URL, requestPayload(profile, {
      cursor,
      limit: pageSize,
      requestId: pagesFetched + 1,
    }))
    pagesFetched += 1

    let page
    try {
      page = parsePage(response)
    } catch (error) {
      throw paginationFailure('protocol_error', 'ERROR', {
        pagesFetched,
        recordsFetchedRaw,
        uniqueSourceRecords: productsByIdentity.size,
        finalCursorState: cursor === null ? 'initial' : 'present',
      }, error.message)
    }

    recordsFetchedRaw += page.products.length
    for (const product of page.products) {
      const identity = sourceProductIdentity(product)
      if (!identity) {
        throw paginationFailure('missing_source_identity', 'ERROR', {
          pagesFetched,
          recordsFetchedRaw,
          uniqueSourceRecords: productsByIdentity.size,
          finalCursorState: page.hasNextPage ? 'present' : 'absent',
        }, 'Japan Figure product is missing both id and url.')
      }
      if (!productsByIdentity.has(identity)) productsByIdentity.set(identity, product)
    }

    if (!page.hasNextPage) {
      const products = [...productsByIdentity.values()]
      return {
        source: JAPAN_FIGURE_FAMILY,
        status: 'PASS',
        raw: recordsFetchedRaw,
        records: products.map((product) => parseJapanFigureProduct(product, profile)),
        pagination: paginationEvidence({
          status: 'PASS',
          pagesFetched,
          recordsFetchedRaw,
          uniqueSourceRecords: products.length,
          paginationExhausted: true,
          terminationReason: 'source_exhausted',
          finalCursorState: 'absent',
        }),
      }
    }

    if (cursor !== null && page.nextCursor === cursor) {
      throw paginationFailure('same_cursor', 'ERROR', {
        pagesFetched,
        recordsFetchedRaw,
        uniqueSourceRecords: productsByIdentity.size,
        finalCursorState: 'present',
      }, 'Japan Figure pagination returned the current cursor again.')
    }
    if (seenCursors.has(page.nextCursor)) {
      throw paginationFailure('cursor_cycle', 'ERROR', {
        pagesFetched,
        recordsFetchedRaw,
        uniqueSourceRecords: productsByIdentity.size,
        finalCursorState: 'present',
      }, 'Japan Figure pagination returned a previously visited cursor.')
    }
    if (pagesFetched >= maxPages) {
      throw paginationFailure('safety_cap', 'INCOMPLETE', {
        pagesFetched,
        recordsFetchedRaw,
        uniqueSourceRecords: productsByIdentity.size,
        finalCursorState: 'present',
      }, `Japan Figure pagination reached the ${maxPages}-page safety cap before exhaustion.`)
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }

  throw new Error('Japan Figure pagination ended unexpectedly.')
}
