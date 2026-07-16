import http from 'node:http'
import https from 'node:https'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const allowedHosts = new Set(['127.0.0.1', '::1'])
const counts = (globalThis.__PERSONAL_GALLERY_NETWORK_COUNTS__ ??= {
  blockedExternal: 0,
  firecrawl: 0,
  hpoi: 0,
  loopback: 0,
})

function hostnameFromRequest(args, defaultProtocol) {
  const first = args[0]
  if (first instanceof URL) return first.hostname
  if (typeof first === 'string') {
    try {
      return new URL(first).hostname
    } catch {
      return args[1]?.hostname || args[1]?.host || '127.0.0.1'
    }
  }
  const options = first || {}
  if (options.hostname || options.host) return String(options.hostname || options.host).split(':')[0]
  if (options.href) return new URL(options.href, `${defaultProtocol}://127.0.0.1`).hostname
  return '127.0.0.1'
}

function assertLoopback(hostname) {
  const normalized = String(hostname).replace(/^\[|\]$/g, '').toLowerCase()
  if (normalized.endsWith('hpoi.net')) counts.hpoi += 1
  if (normalized === 'api.firecrawl.dev' || normalized.endsWith('.firecrawl.dev')) counts.firecrawl += 1
  if (!allowedHosts.has(normalized)) {
    counts.blockedExternal += 1
    throw new Error(`Offline test network guard blocked external host: ${normalized}`)
  }
  counts.loopback += 1
}

const originalFetch = globalThis.fetch
globalThis.fetch = async function guardedFetch(input, init) {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url)
  assertLoopback(url.hostname)
  return originalFetch(input, init)
}

for (const [module, protocol] of [
  [http, 'http'],
  [https, 'https'],
]) {
  const originalRequest = module.request.bind(module)
  module.request = function guardedRequest(...args) {
    assertLoopback(hostnameFromRequest(args, protocol))
    return originalRequest(...args)
  }
  module.get = function guardedGet(...args) {
    const request = module.request(...args)
    request.end()
    return request
  }
}

process.env.HPOI_LIVE_FETCH_ENABLED = 'false'
process.env.HPOI_WRITTEN_PERMISSION_CONFIRMED = 'false'
delete process.env.FIRECRAWL_API_KEY

process.on('exit', () => {
  const directory = process.env.MVP_NETWORK_RESULT_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, `unit-network-${process.pid}.json`),
    `${JSON.stringify({ kind: 'offline-unit', ...counts }, null, 2)}\n`,
    'utf8',
  )
})
