import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { lookup as defaultDnsLookup } from 'node:dns/promises'
import https from 'node:https'
import { isIP } from 'node:net'
import path from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { isHpoiHost } from '../parsers/official-urls.js'
import { sha256 } from './identity.js'

const BLOCKING_STATUS = new Set([401, 403, 429])
const MIME_BY_KIND = Object.freeze({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })
const BLOCKING_BODY_PATTERNS = [
  ['captcha', /(?:captcha|hcaptcha|recaptcha|验证码)/iu],
  ['robot_verification', /(?:robot verification|verify (?:that )?you are human|机器人验证|人机验证)/iu],
  ['access_denied', /(?:access denied|request (?:was )?blocked|访问被拒绝|拒绝访问)/iu],
  ['login_required', /(?:login required|sign in to continue|请先登录|登录后(?:继续|访问))/iu],
  ['robots_denied', /(?:robots\.txt[^<]{0,80}(?:disallow|denied|forbidden)|robots (?:policy )?(?:denied|forbidden))/iu],
]

export class ImageDownloadError extends Error {
  constructor(message, { code = 'image_download_failed', status = null, blocked = false, url = null } = {}) {
    super(message)
    this.name = 'ImageDownloadError'
    this.code = code
    this.status = status
    this.blocked = blocked
    this.url = url
  }
}

function ipv4Number(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

const IPV4_BLOCKS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([address, prefix]) => ({ base: ipv4Number(address), prefix }))

function inIpv4Block(value, { base, prefix }) {
  const shift = 32 - prefix
  return (value >>> shift) === (base >>> shift)
}

function ipv6Number(address) {
  let value = address.toLowerCase()
  if (value.includes('%')) return null
  const dottedIndex = value.lastIndexOf(':')
  if (value.includes('.')) {
    const ipv4 = ipv4Number(value.slice(dottedIndex + 1))
    if (ipv4 === null) return null
    value = `${value.slice(0, dottedIndex)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`
  }
  const sides = value.split('::')
  if (sides.length > 2) return null
  const left = sides[0] ? sides[0].split(':') : []
  const right = sides[1] ? sides[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((sides.length === 1 && missing !== 0) || (sides.length === 2 && missing < 1)) return null
  const parts = [...left, ...Array(missing).fill('0'), ...right]
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  return parts.reduce((output, part) => (output << 16n) | BigInt(`0x${part}`), 0n)
}

const IPV6_BLOCKS = [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
].map(([address, prefix]) => ({ base: ipv6Number(address), prefix }))

function inIpv6Block(value, { base, prefix }) {
  const shift = BigInt(128 - prefix)
  return (value >> shift) === (base >> shift)
}

export function isPublicAddress(address) {
  const family = isIP(address)
  if (family === 4) {
    const value = ipv4Number(address)
    return value !== null && !IPV4_BLOCKS.some((block) => inIpv4Block(value, block))
  }
  if (family === 6) {
    const value = ipv6Number(address)
    if (value === null) return false
    const mappedPrefix = ipv6Number('::ffff:0:0') >> 32n
    if ((value >> 32n) === mappedPrefix) {
      const mapped = Number(value & 0xffffffffn)
      return !IPV4_BLOCKS.some((block) => inIpv4Block(mapped, block))
    }
    return !IPV6_BLOCKS.some((block) => inIpv6Block(value, block))
  }
  return false
}

function imageKind(buffer) {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'webp'
  return null
}

function cleanMime(value) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() || null
}

async function bodyWithLimit(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ImageDownloadError(`Image exceeds ${maxBytes} bytes.`, { code: 'image_too_large' })
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel('image size limit exceeded').catch(() => {})
        throw new ImageDownloadError(`Image exceeds ${maxBytes} bytes.`, { code: 'image_too_large' })
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

export function createPinnedLookup(records) {
  const addresses = Object.freeze(
    (records || []).map((record) => {
      const address = String(record?.address || '')
      const family = isIP(address)
      if (!family || !isPublicAddress(address)) {
        throw new ImageDownloadError('Cannot pin an unvalidated image host address.', {
          code: 'image_host_not_public',
          blocked: true,
        })
      }
      return Object.freeze({ address, family })
    }),
  )
  if (addresses.length === 0) {
    throw new ImageDownloadError('Cannot pin an image host without a public address.', {
      code: 'image_host_not_public',
      blocked: true,
    })
  }
  return function pinnedLookup(_hostname, options, callback) {
    const normalizedOptions = typeof options === 'number' ? { family: options } : options || {}
    const requestedFamily = Number(normalizedOptions.family) || 0
    const candidates = requestedFamily
      ? addresses.filter((record) => record.family === requestedFamily)
      : addresses
    if (candidates.length === 0) {
      return callback(Object.assign(new Error('No validated address matches the requested family.'), {
        code: 'ENOTFOUND',
      }))
    }
    if (normalizedOptions.all) return callback(null, candidates.map((record) => ({ ...record })))
    return callback(null, candidates[0].address, candidates[0].family)
  }
}

async function assertAllowed(url, allowImageUrl, sourceProductUrl, dnsLookup) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new ImageDownloadError('Invalid image URL.', { code: 'invalid_image_url', url })
  }
  if (parsed.protocol !== 'https:') {
    throw new ImageDownloadError('Image URL must use HTTPS.', { code: 'image_url_not_allowed', blocked: true, url })
  }
  if (isHpoiHost(parsed.hostname)) {
    throw new ImageDownloadError('Hpoi and known Hpoi mirror image hosts are permanently denied.', {
      code: 'hpoi_image_host_denied',
      blocked: true,
      url,
    })
  }
  if (!allowImageUrl(url, { sourceProductUrl })) {
    throw new ImageDownloadError('Image URL host is not allowlisted for this product.', {
      code: 'image_url_not_allowed',
      blocked: true,
      url,
    })
  }
  if (parsed.username || parsed.password) {
    throw new ImageDownloadError('Image URL credentials are not allowed.', { code: 'image_url_not_allowed', blocked: true, url })
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new ImageDownloadError('Image host is not public.', { code: 'image_host_not_public', blocked: true, url })
  }
  const literalFamily = isIP(hostname)
  if (literalFamily) {
    if (!isPublicAddress(hostname)) {
      throw new ImageDownloadError('Image host address is not public.', { code: 'image_host_not_public', blocked: true, url })
    }
    return { parsed, records: [{ address: hostname, family: literalFamily }] }
  }
  let records
  try {
    records = await dnsLookup(hostname, { all: true, verbatim: true })
  } catch (error) {
    throw new ImageDownloadError(`Image host DNS validation failed: ${error.message}`, {
      code: 'image_host_not_public',
      blocked: true,
      url,
    })
  }
  if (!Array.isArray(records) || records.length === 0 || records.some((record) => !isPublicAddress(record?.address))) {
    throw new ImageDownloadError('Image host did not resolve exclusively to public addresses.', {
      code: 'image_host_not_public',
      blocked: true,
      url,
    })
  }
  return {
    parsed,
    records: records.map((record) => ({ address: record.address, family: isIP(record.address) })),
  }
}

function incomingHeaders(response) {
  return {
    get(name) {
      const value = response.headers?.[String(name).toLowerCase()]
      if (Array.isArray(value)) return value.join(', ')
      return value === undefined ? null : String(value)
    },
  }
}

async function pinnedHttpsFetch(url, { records, signal, httpsRequest }) {
  const parsed = new URL(url)
  const lookup = createPinnedLookup(records)
  return new Promise((resolve, reject) => {
    const request = httpsRequest(parsed, {
      method: 'GET',
      agent: false,
      lookup,
      signal,
      servername: isIP(parsed.hostname) ? undefined : parsed.hostname,
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1',
      },
    }, (response) => {
      const status = Number(response.statusCode || 0)
      resolve({
        status,
        ok: status >= 200 && status < 300,
        headers: incomingHeaders(response),
        body: [204, 205, 304].includes(status) ? null : Readable.toWeb(response),
      })
    })
    request.once('error', reject)
    request.end()
  })
}

async function fetchWithManualRedirects({
  url,
  fetchImpl,
  allowImageUrl,
  sourceProductUrl,
  signal,
  maxRedirects,
  dnsLookup,
  httpsRequest,
}) {
  let current = url
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const validated = await assertAllowed(current, allowImageUrl, sourceProductUrl, dnsLookup)
    const response = fetchImpl
      ? await fetchImpl(current, { method: 'GET', redirect: 'manual', signal })
      : await pinnedHttpsFetch(current, { records: validated.records, signal, httpsRequest })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) {
        throw new ImageDownloadError('Image redirect has no Location header.', {
          code: 'invalid_redirect',
          status: response.status,
          url: current,
        })
      }
      if (redirects === maxRedirects) {
        throw new ImageDownloadError('Image redirect limit exceeded.', { code: 'redirect_limit', url: current })
      }
      const next = new URL(location, current).toString()
      current = next
      continue
    }
    return { response, finalUrl: current, redirects }
  }
  throw new ImageDownloadError('Image redirect limit exceeded.', { code: 'redirect_limit', url: current })
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function atomicWriteBuffer(filePath, buffer) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temporaryPath, 'wx')
    await handle.writeFile(buffer)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, filePath)
  } finally {
    if (handle) await handle.close().catch(() => {})
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

export async function downloadAndStoreImage({
  url,
  sourceProductUrl,
  productKey,
  store,
  fetchImpl = null,
  allowImageUrl,
  maxBytes,
  signal,
  maxRedirects = 3,
  dnsLookup = defaultDnsLookup,
  httpsRequest = https.request,
  runId = null,
  deferRegistration = false,
}) {
  if (fetchImpl !== null && typeof fetchImpl !== 'function') {
    throw new Error('downloadAndStoreImage fetchImpl must be a function when supplied.')
  }
  if (!fetchImpl && typeof httpsRequest !== 'function') {
    throw new Error('downloadAndStoreImage requires the built-in HTTPS transport.')
  }
  if (typeof allowImageUrl !== 'function') throw new Error('downloadAndStoreImage requires allowImageUrl.')
  if (!store || !productKey) throw new Error('downloadAndStoreImage requires store and productKey.')

  let fetched
  try {
    fetched = await fetchWithManualRedirects({
      url,
      fetchImpl,
      allowImageUrl,
      sourceProductUrl,
      signal,
      maxRedirects,
      dnsLookup,
      httpsRequest,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    if (error instanceof ImageDownloadError) throw error
    throw new ImageDownloadError(`Image request failed: ${error.message}`, { code: 'network_error', url })
  }

  const { response, finalUrl, redirects } = fetched
  let finalPath = ''
  try {
    finalPath = new URL(finalUrl).pathname
  } catch {
    // The URL was validated before fetch; custom test transports can still
    // return malformed values, which will fail the normal content checks.
  }
  if (/\/(?:login|log-in|signin|sign-in|auth)(?:\/|$)/i.test(finalPath)) {
    throw new ImageDownloadError('Image request stopped after redirecting to a login path.', {
      blocked: true,
      code: 'login_required',
      status: response.status,
      url: finalUrl,
    })
  }
  if (BLOCKING_STATUS.has(response.status)) {
    throw new ImageDownloadError(`Image access stopped with HTTP ${response.status}.`, {
      blocked: true,
      code: `http_${response.status}`,
      status: response.status,
      url: finalUrl,
    })
  }
  if (!response.ok) {
    throw new ImageDownloadError(`Image request failed with HTTP ${response.status}.`, {
      code: `http_${response.status}`,
      status: response.status,
      url: finalUrl,
    })
  }

  const buffer = await bodyWithLimit(response, maxBytes)
  const prefix = buffer.subarray(0, Math.min(buffer.length, 64 * 1024)).toString('utf8')
  for (const [code, pattern] of BLOCKING_BODY_PATTERNS) {
    if (pattern.test(prefix)) {
      throw new ImageDownloadError(`Image request stopped after detecting ${code.replaceAll('_', ' ')}.`, {
        code,
        blocked: true,
        status: response.status,
        url: finalUrl,
      })
    }
  }
  const kind = imageKind(buffer)
  if (!kind) {
    throw new ImageDownloadError('Response is not a supported PNG, JPEG, or WebP image.', { code: 'invalid_magic', url: finalUrl })
  }
  const declaredMime = cleanMime(response.headers.get('content-type'))
  if (declaredMime !== MIME_BY_KIND[kind]) {
    throw new ImageDownloadError(`Declared MIME ${declaredMime || '(missing)'} does not match ${MIME_BY_KIND[kind]}.`, {
      code: 'mime_mismatch',
      url: finalUrl,
    })
  }

  let metadata
  try {
    metadata = await sharp(buffer, { failOn: 'error' }).metadata()
  } catch (error) {
    throw new ImageDownloadError(`Image decoder rejected the file: ${error.message}`, {
      code: 'invalid_image',
      url: finalUrl,
    })
  }
  if (!metadata.width || !metadata.height) {
    throw new ImageDownloadError('Image dimensions are unavailable.', { code: 'missing_dimensions', url: finalUrl })
  }
  if (metadata.width <= 2 || metadata.height <= 2) {
    throw new ImageDownloadError('Image dimensions match a tracking pixel.', { code: 'tracking_pixel', url: finalUrl })
  }

  const digest = sha256(buffer)
  const extension = kind === 'jpeg' ? 'jpg' : kind
  const targetPath = store.objectPath(digest, extension)
  const duplicate = await exists(targetPath)
  if (!duplicate) await atomicWriteBuffer(targetPath, buffer)

  const image = {
    sha256: digest,
    extension,
    mime: MIME_BY_KIND[kind],
    bytes: buffer.length,
    width: metadata.width,
    height: metadata.height,
    path: targetPath,
    duplicate,
    originalUrl: url,
    finalUrl,
    redirects,
  }
  if (!deferRegistration) {
    const registrations = [{ runId, productKey, url, sourceProductUrl, image }]
    if (finalUrl !== url) registrations.push({ runId, productKey, url: finalUrl, sourceProductUrl, image })
    if (typeof store.registerImages === 'function') await store.registerImages(registrations)
    else {
      for (const registration of registrations) await store.registerImage(registration)
    }
  }
  return { ...image, registrationDeferred: deferRegistration }
}
