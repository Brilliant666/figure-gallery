import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import sharp from 'sharp'
import { GalleryStore } from '../../src/storage/gallery-store.js'
import {
  createPinnedLookup,
  downloadAndStoreImage,
  ImageDownloadError,
  isPublicAddress,
} from '../../src/storage/image-store.js'

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-images-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = await new GalleryStore(root).initialize()
  const run = await store.createRun({ query: 'synthetic-character' })
  const product = await store.upsertProduct(run.runId, {
    sourceType: 'hpoi',
    sourceItemId: '100',
    sourceUrl: 'https://www.hpoi.net/hobby/100',
    title: 'Synthetic Figure',
  })
  return { root, store, productKey: product.productKey }
}

function response(buffer, { status = 200, contentType = 'image/png', headers = {} } = {}) {
  return new Response(buffer, {
    status,
    headers: { 'content-type': contentType, 'content-length': String(buffer?.length || 0), ...headers },
  })
}

const allowImageUrl = (url) => new URL(url).hostname === 'img.example.test'
const publicDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }]

async function png(red = 20) {
  return sharp({ create: { width: 8, height: 6, channels: 3, background: { r: red, g: 30, b: 40 } } })
    .png()
    .toBuffer()
}

async function webp() {
  return sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 30, g: 80, b: 120 } } })
    .webp()
    .toBuffer()
}

test('public WebP samples pass magic, MIME, dimensions, and content-addressed storage', async (t) => {
  const { store, productKey } = await setup(t)
  const body = await webp()
  const result = await downloadAndStoreImage({
    url: 'https://img.example.test/sample.webp',
    sourceProductUrl: 'https://goodsmile.com/en/product/cheshire',
    productKey,
    store,
    fetchImpl: async () => response(body, { contentType: 'image/webp' }),
    allowImageUrl,
    dnsLookup: publicDnsLookup,
    maxBytes: 1_000_000,
  })
  assert.equal(result.extension, 'webp')
  assert.equal(result.mime, 'image/webp')
  assert.equal(result.width, 8)
  assert.equal(result.height, 6)
})

test('production HTTPS transport pins the validated public address into the actual connection lookup', async (t) => {
  const { store, productKey } = await setup(t)
  const body = await png()
  const mutableDnsRecords = [{ address: '93.184.216.34', family: 4 }]
  let dnsCalls = 0
  let connectedAddress = null
  const httpsRequest = (_url, options, callback) => {
    const request = new EventEmitter()
    request.end = () => {
      mutableDnsRecords[0].address = '127.0.0.1'
      options.lookup('img.example.test', { family: 4 }, (error, address) => {
        if (error) return request.emit('error', error)
        connectedAddress = address
        const incoming = Readable.from([body])
        incoming.statusCode = 200
        incoming.headers = {
          'content-type': 'image/png',
          'content-length': String(body.length),
        }
        callback(incoming)
      })
    }
    return request
  }

  const result = await downloadAndStoreImage({
    url: 'https://img.example.test/pinned.png',
    sourceProductUrl: 'https://goodsmile.com/en/product/cheshire',
    productKey,
    store,
    allowImageUrl,
    dnsLookup: async () => {
      dnsCalls += 1
      return mutableDnsRecords
    },
    httpsRequest,
    maxBytes: 1_000_000,
  })
  assert.equal(result.mime, 'image/png')
  assert.equal(dnsCalls, 1)
  assert.equal(connectedAddress, '93.184.216.34')
})

test('pinned lookup never accepts private or unvalidated addresses', () => {
  assert.throws(
    () => createPinnedLookup([{ address: '127.0.0.1', family: 4 }]),
    (error) => error instanceof ImageDownloadError && error.code === 'image_host_not_public' && error.blocked,
  )
})

test('images are validated, content-addressed, linked many-to-many, and deduplicated across URLs', async (t) => {
  const { root, store, productKey } = await setup(t)
  const body = await png()
  const fetchImpl = async () => response(body)
  const first = await downloadAndStoreImage({
    url: 'https://img.example.test/a.png',
    sourceProductUrl: 'https://www.hpoi.net/hobby/100',
    productKey,
    store,
    fetchImpl,
    allowImageUrl,
    dnsLookup: publicDnsLookup,
    maxBytes: 1_000_000,
  })
  const second = await downloadAndStoreImage({
    url: 'https://img.example.test/renamed.png',
    sourceProductUrl: 'https://www.hpoi.net/hobby/100',
    productKey,
    store,
    fetchImpl,
    allowImageUrl,
    dnsLookup: publicDnsLookup,
    maxBytes: 1_000_000,
  })

  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true)
  assert.equal(first.sha256, second.sha256)
  assert.equal(first.width, 8)
  assert.equal(first.height, 6)
  assert.equal((await stat(first.path)).size, body.length)
  const index = await store.readImageIndex()
  assert.equal(Object.keys(index.objects).length, 1)
  assert.deepEqual(index.objects[first.sha256].sourceUrls.sort(), [
    'https://img.example.test/a.png',
    'https://img.example.test/renamed.png',
  ])
  assert.equal(index.objects[first.sha256].productKeys[0], productKey)
  assert.equal(path.relative(root, first.path).includes('objects'), true)
})

test('same URL with changed content creates a new immutable object and preserves URL history', async (t) => {
  const { store, productKey } = await setup(t)
  const bodies = [await png(20), await png(200)]
  let request = 0
  const fetchImpl = async () => response(bodies[request++])
  const input = {
    url: 'https://img.example.test/stable.png',
    sourceProductUrl: 'https://www.hpoi.net/hobby/100',
    productKey,
    store,
    fetchImpl,
    allowImageUrl,
    dnsLookup: publicDnsLookup,
    maxBytes: 1_000_000,
  }
  const first = await downloadAndStoreImage(input)
  const second = await downloadAndStoreImage(input)
  assert.notEqual(first.sha256, second.sha256)
  const index = await store.readImageIndex()
  assert.equal(Object.keys(index.objects).length, 2)
  assert.deepEqual(index.urlHistory[input.url], [first.sha256, second.sha256])
})

test('image download rejects invalid magic, MIME mismatch, oversized content, denied redirects, and 403', async (t) => {
  const { store, productKey } = await setup(t)
  const base = {
    url: 'https://img.example.test/a.png',
    sourceProductUrl: 'https://www.hpoi.net/hobby/100',
    productKey,
    store,
    allowImageUrl,
    dnsLookup: publicDnsLookup,
    maxBytes: 100,
  }

  await assert.rejects(
    downloadAndStoreImage({ ...base, fetchImpl: async () => response(Buffer.from('not an image'), { contentType: 'image/png' }) }),
    (error) => error instanceof ImageDownloadError && error.code === 'invalid_magic',
  )
  await assert.rejects(
    downloadAndStoreImage({ ...base, fetchImpl: async () => response(await png(), { contentType: 'image/jpeg' }) }),
    (error) => error instanceof ImageDownloadError && error.code === 'mime_mismatch',
  )
  await assert.rejects(
    downloadAndStoreImage({ ...base, maxBytes: 3, fetchImpl: async () => response(await png()) }),
    (error) => error instanceof ImageDownloadError && error.code === 'image_too_large',
  )
  await assert.rejects(
    downloadAndStoreImage({
      ...base,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/a.png' } }),
    }),
    (error) => error instanceof ImageDownloadError && error.code === 'image_url_not_allowed' && error.blocked,
  )
  await assert.rejects(
    downloadAndStoreImage({ ...base, fetchImpl: async () => new Response(null, { status: 403 }) }),
    (error) => error instanceof ImageDownloadError && error.code === 'http_403' && error.blocked,
  )
  let loginRedirectCalls = 0
  await assert.rejects(
    downloadAndStoreImage({
      ...base,
      fetchImpl: async () => {
        loginRedirectCalls += 1
        return loginRedirectCalls === 1
          ? new Response(null, { status: 302, headers: { location: 'https://img.example.test/login' } })
          : new Response('<html><body>synthetic sign-in shell</body></html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            })
      },
    }),
    (error) => error instanceof ImageDownloadError && error.code === 'login_required' && error.blocked,
  )
  assert.equal(loginRedirectCalls, 2)
})

test('Hpoi and known mirror image hosts are denied before DNS or fetch, including redirects', async (t) => {
  const { store, productKey } = await setup(t)
  let dnsCalls = 0
  let fetchCalls = 0
  const base = {
    sourceProductUrl: 'https://goodsmile.com/en/product/cheshire',
    productKey,
    store,
    allowImageUrl: () => true,
    dnsLookup: async () => {
      dnsCalls += 1
      return [{ address: '93.184.216.34', family: 4 }]
    },
    maxBytes: 1_000_000,
  }

  for (const url of [
    'https://img.hpoi.net/sample.png',
    'https://cdn.hpoi.net.cn/sample.png',
  ]) {
    await assert.rejects(
      downloadAndStoreImage({
        ...base,
        url,
        fetchImpl: async () => {
          fetchCalls += 1
          return response(await png())
        },
      }),
      (error) => error instanceof ImageDownloadError && error.code === 'hpoi_image_host_denied' && error.blocked,
    )
  }
  assert.equal(dnsCalls, 0)
  assert.equal(fetchCalls, 0)

  await assert.rejects(
    downloadAndStoreImage({
      ...base,
      url: 'https://img.example.test/start.png',
      fetchImpl: async () => {
        fetchCalls += 1
        return new Response(null, {
          status: 302,
          headers: { location: 'https://static.hpoi.net/redirected.png' },
        })
      },
    }),
    (error) => error instanceof ImageDownloadError && error.code === 'hpoi_image_host_denied' && error.blocked,
  )
  assert.equal(fetchCalls, 1)
  assert.equal(dnsCalls, 1)
})

test('interrupted response leaves no object or temporary file', async (t) => {
  const { root, store, productKey } = await setup(t)
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
      controller.error(new Error('synthetic interruption'))
    },
  })
  await assert.rejects(
    downloadAndStoreImage({
      url: 'https://img.example.test/interrupted.png',
      sourceProductUrl: 'https://www.hpoi.net/hobby/100',
      productKey,
      store,
      fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'image/png' } }),
      allowImageUrl,
      dnsLookup: publicDnsLookup,
      maxBytes: 1_000_000,
    }),
  )
  const files = await readdir(root, { recursive: true })
  assert.equal(files.some((file) => file.endsWith('.tmp')), false)
  const index = await store.readImageIndex()
  assert.deepEqual(index.objects, {})
})

for (const [label, body, code] of [
  ['captcha', '<html><title>Captcha</title><p>Verify that you are human</p></html>', 'captcha'],
  ['login', '<html><title>Login required</title><p>Sign in to continue</p></html>', 'login_required'],
  ['robot verification', '<html><p>Robot verification</p></html>', 'robot_verification'],
  ['access denied', '<html><h1>Access denied</h1></html>', 'access_denied'],
]) {
  test(`HTTP 200 HTML ${label} response is a terminal image block and is not stored`, async (t) => {
    const { store, productKey } = await setup(t)
    await assert.rejects(
      downloadAndStoreImage({
        url: 'https://img.example.test/a.png',
        sourceProductUrl: 'https://www.hpoi.net/hobby/100',
        productKey,
        store,
        fetchImpl: async () => response(Buffer.from(body), { contentType: 'text/html' }),
        allowImageUrl,
        dnsLookup: publicDnsLookup,
        maxBytes: 1_000_000,
      }),
      (error) => error instanceof ImageDownloadError && error.code === code && error.blocked,
    )
    assert.deepEqual((await store.readImageIndex()).objects, {})
  })
}

test('decoded tracking-pixel dimensions are rejected before object storage', async (t) => {
  const { store, productKey } = await setup(t)
  const pixel = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer()
  await assert.rejects(
    downloadAndStoreImage({
      url: 'https://img.example.test/pixel.png',
      sourceProductUrl: 'https://www.hpoi.net/hobby/100',
      productKey,
      store,
      fetchImpl: async () => response(pixel),
      allowImageUrl,
      dnsLookup: publicDnsLookup,
      maxBytes: 1_000_000,
    }),
    (error) => error instanceof ImageDownloadError && error.code === 'tracking_pixel' && !error.blocked,
  )
  assert.deepEqual((await store.readImageIndex()).objects, {})
})

test('public-address classifier rejects private, local, link-local, unspecified, multicast, and reserved literals', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.2.1',
    '203.0.113.1',
    '224.0.0.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
  ]) assert.equal(isPublicAddress(address), false, address)
  assert.equal(isPublicAddress('93.184.216.34'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
})

for (const url of [
  'https://127.0.0.1/a.png',
  'https://10.0.0.1/a.png',
  'https://169.254.1.1/a.png',
  'https://[::1]/a.png',
  'https://[fc00::1]/a.png',
  'https://localhost/a.png',
  'https://localhost./a.png',
  'https://image.localhost/a.png',
]) {
  test(`SSRF guard blocks non-public image literal or local host ${url}`, async (t) => {
    const { store, productKey } = await setup(t)
    let fetchCalls = 0
    let dnsCalls = 0
    await assert.rejects(
      downloadAndStoreImage({
        url,
        sourceProductUrl: 'https://www.hpoi.net/hobby/100',
        productKey,
        store,
        fetchImpl: async () => { fetchCalls += 1; return response(await png()) },
        allowImageUrl: () => true,
        dnsLookup: async () => { dnsCalls += 1; throw new Error('literal must not resolve') },
        maxBytes: 1_000_000,
      }),
      (error) => error instanceof ImageDownloadError && error.code === 'image_host_not_public' && error.blocked,
    )
    assert.equal(fetchCalls, 0)
    assert.equal(dnsCalls, 0)
  })
}

test('SSRF guard requires HTTPS before DNS or fetch', async (t) => {
  const { store, productKey } = await setup(t)
  let dnsCalls = 0
  let fetchCalls = 0
  await assert.rejects(
    downloadAndStoreImage({
      url: 'http://img.example.test/a.png',
      sourceProductUrl: 'https://www.hpoi.net/hobby/100',
      productKey,
      store,
      fetchImpl: async () => { fetchCalls += 1 },
      allowImageUrl: () => true,
      dnsLookup: async () => { dnsCalls += 1; return [{ address: '93.184.216.34', family: 4 }] },
      maxBytes: 1_000_000,
    }),
    (error) => error instanceof ImageDownloadError && error.code === 'image_url_not_allowed' && error.blocked,
  )
  assert.equal(dnsCalls, 0)
  assert.equal(fetchCalls, 0)
})

test('SSRF guard blocks DNS failures and any non-public resolved address before fetch', async (t) => {
  const { store, productKey } = await setup(t)
  let fetchCalls = 0
  const base = {
    url: 'https://img.example.test/a.png',
    sourceProductUrl: 'https://www.hpoi.net/hobby/100',
    productKey,
    store,
    fetchImpl: async () => { fetchCalls += 1; return response(await png()) },
    allowImageUrl: () => true,
    maxBytes: 1_000_000,
  }
  await assert.rejects(
    downloadAndStoreImage({ ...base, dnsLookup: async () => { throw new Error('synthetic DNS failure') } }),
    (error) => error instanceof ImageDownloadError && error.code === 'image_host_not_public' && error.blocked,
  )
  await assert.rejects(
    downloadAndStoreImage({
      ...base,
      dnsLookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.2', family: 4 },
      ],
    }),
    (error) => error instanceof ImageDownloadError && error.code === 'image_host_not_public' && error.blocked,
  )
  assert.equal(fetchCalls, 0)
})

test('SSRF guard revalidates every redirect target and blocks a private resolution', async (t) => {
  const { store, productKey } = await setup(t)
  const lookups = []
  let fetchCalls = 0
  await assert.rejects(
    downloadAndStoreImage({
      url: 'https://img.example.test/a.png',
      sourceProductUrl: 'https://www.hpoi.net/hobby/100',
      productKey,
      store,
      fetchImpl: async () => {
        fetchCalls += 1
        return new Response(null, { status: 302, headers: { location: 'https://private.example/a.png' } })
      },
      allowImageUrl: () => true,
      dnsLookup: async (hostname) => {
        lookups.push(hostname)
        return [{ address: hostname === 'private.example' ? '192.168.1.5' : '93.184.216.34', family: 4 }]
      },
      maxBytes: 1_000_000,
    }),
    (error) => error instanceof ImageDownloadError && error.code === 'image_host_not_public' && error.blocked,
  )
  assert.equal(fetchCalls, 1)
  assert.deepEqual(lookups, ['img.example.test', 'private.example'])
})
