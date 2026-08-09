import { createReadStream, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { officialLiveGate, TOOL_ROOT } from '../config.js'
import { resolveMediaObject } from '../gallery/read-model.js'
import { createDefaultRuntime } from './runtime-adapter.js'
import { normalizeCharacterSlug, resolveBuiltinCharacter } from '../characters/registry.js'

const STATIC_ROOT = path.join(TOOL_ROOT, 'static')
const BODY_LIMIT = 64 * 1024
const STATIC_FILES = new Map([
  ['/assets/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/assets/home.js', ['home.js', 'text/javascript; charset=utf-8']],
  ['/assets/gallery.js', ['gallery.js', 'text/javascript; charset=utf-8']],
])

function securityHeaders(contentType = null) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  }
  if (contentType) headers['Content-Type'] = contentType
  return headers
}

function sendJson(response, status, value) {
  response.writeHead(status, securityHeaders('application/json; charset=utf-8'))
  response.end(`${JSON.stringify(value)}\n`)
}

async function sendFile(response, filePath, contentType) {
  try {
    const stat = await fs.stat(filePath)
    response.writeHead(200, { ...securityHeaders(contentType), 'Content-Length': stat.size })
    createReadStream(filePath).pipe(response)
  } catch (error) {
    if (error?.code === 'ENOENT') return sendJson(response, 404, { error: 'not_found' })
    throw error
  }
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > BODY_LIMIT) throw Object.assign(new Error('request_too_large'), { statusCode: 413 })
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('invalid_json'), { statusCode: 400 })
  }
}

function safeError(error) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  return message
    .replace(/(authorization|api[-_ ]?key|bearer)\s*[:=]?\s*\S+/gi, '$1 [redacted]')
    .slice(0, 500)
}

function isLoopbackHostHeader(value) {
  if (typeof value !== 'string' || !value) return false
  try {
    const parsed = new URL(`http://${value}`)
    return parsed.hostname === '127.0.0.1' && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

function isAllowedMutationRequest(request, hostHeader) {
  const fetchSite = request.headers['sec-fetch-site']
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false
  const origin = request.headers.origin
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    const expected = new URL(`http://${hostHeader}`)
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.host === expected.host
  } catch {
    return false
  }
}

function runIdFor(query) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')
  const queryHash = createHash('sha256').update(query.normalize('NFKC')).digest('hex').slice(0, 16)
  return `${stamp}-${queryHash}-${randomUUID().slice(0, 8)}`
}

function boundedInteger(value, fallback, min, max) {
  const candidate = Number(value)
  return Number.isInteger(candidate) && candidate >= min && candidate <= max ? candidate : fallback
}

export function createJobManager(config, runtime) {
  let active = null
  let last = null

  function publicJob(job) {
    if (!job) return null
    return {
      runId: job.runId,
      query: job.query,
      characterSlug: job.characterSlug || null,
      sourceMode: 'official_sources',
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt || null,
      progress: job.progress,
      stopReason: job.stopReason || null,
      galleryUrl: job.galleryUrl || null,
      disambiguationCandidates: job.disambiguationCandidates || [],
    }
  }

  async function start(input) {
    if (active) {
      return { accepted: false, statusCode: 409, job: publicJob(active), error: 'run_already_active' }
    }
    const query = typeof input.query === 'string' ? input.query.trim() : ''
    if (!query) return { accepted: false, statusCode: 400, error: 'query_required' }

    const character = typeof runtime.resolveCharacter === 'function'
      ? await runtime.resolveCharacter(query)
      : resolveBuiltinCharacter(query)
    if (!character) {
      return {
        accepted: false,
        statusCode: 409,
        error: 'character_confirmation_required',
        suggestedCharacter: {
          displayName: query,
          slug: normalizeCharacterSlug(input.slug || query),
          aliases: [query],
          workNames: [],
        },
      }
    }

    if (input.characterUrl || (input.sourceMode && input.sourceMode !== 'official_sources')) {
      return {
        accepted: false,
        statusCode: 410,
        error: 'hpoi_live_source_disabled',
        notice: 'Hpoi live access is permanently disabled; use official_sources.',
      }
    }

    const gate = officialLiveGate(config, {
      interactiveConfirmation: input.confirmOfficialSourceAccess === true,
    })
    if (!gate.allowed) {
      last = {
        runId: null,
        query,
        characterSlug: character.slug,
        status: 'environment_blocked',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        progress: { pages: 0, products: 0, images: 0, failures: 0 },
        stopReason: gate.notice,
        galleryUrl: `/gallery/characters/${encodeURIComponent(character.slug)}`,
      }
      return {
        accepted: false,
        statusCode: 412,
        job: publicJob(last),
        error: 'live_gate_blocked',
        missing: gate.missing,
        notice: gate.notice,
      }
    }

    const controller = new AbortController()
    const job = {
      runId: runIdFor(query),
      query,
      characterSlug: character.slug,
      sourceMode: 'official_sources',
      status: 'running',
      startedAt: new Date().toISOString(),
      progress: { pages: 0, products: 0, images: 0, failures: 0 },
      controller,
    }
    job.galleryUrl = `/gallery/characters/${encodeURIComponent(character.slug)}`
    active = job
    last = job
    const options = {
      query,
      characterConfig: character,
      sourceMode: 'official_sources',
      limits: {
        searchLimit: boundedInteger(
          input.maxSearchResults,
          config.officialMaxSearchResultsPerQuery,
          1,
          config.officialMaxSearchResultsPerQuery,
        ),
        maxCandidates: boundedInteger(
          input.maxCandidates,
          config.officialMaxCandidates,
          1,
          config.officialMaxCandidates,
        ),
        maxProducts: boundedInteger(
          input.maxProducts,
          config.officialMaxProducts,
          1,
          config.officialMaxProducts,
        ),
        maxImagesPerProduct: boundedInteger(
          input.maxImagesPerProduct,
          config.officialMaxImagesPerProduct,
          1,
          config.officialMaxImagesPerProduct,
        ),
        requestDelayMs: config.officialRequestDelayMs,
        imageRequestDelayMs: config.officialImageRequestDelayMs,
        imageMaxBytes: config.imageMaxBytes,
      },
      requestedRunId: job.runId,
      signal: controller.signal,
      gate,
      onProgress(progress) {
        job.progress = { ...job.progress, ...progress }
      },
    }

    Promise.resolve(runtime.runCollector(options))
      .then((result = {}) => {
        if (result.runId && result.runId !== job.runId) {
          throw new Error('Collector returned a run ID different from the requested stable run ID.')
        }
        job.status = result.status || (controller.signal.aborted ? 'stopped' : 'completed')
        job.progress = { ...job.progress, ...(result.progress || result.summary || {}) }
        job.stopReason = result.stopReason || null
        job.disambiguationCandidates = result.disambiguationCandidates || []
        job.completedAt = new Date().toISOString()
      })
      .catch((error) => {
        job.status = controller.signal.aborted ? 'stopped' : 'failed'
        job.stopReason = safeError(error)
        job.completedAt = new Date().toISOString()
      })
      .finally(() => {
        if (active === job) active = null
      })

    return { accepted: true, statusCode: 202, job: publicJob(job) }
  }

  function stop() {
    if (!active || active.status !== 'running') return { stopped: false, error: 'no_active_run' }
    active.controller.abort(new Error('Stopped by owner'))
    active.status = 'stopping'
    active.stopReason = 'Stopped by project owner.'
    return { stopped: true, job: publicJob(active) }
  }

  return {
    start,
    stop,
    status: () => publicJob(active || last),
  }
}

export function createPersonalGalleryServer({ config, runtime = createDefaultRuntime(config) }) {
  if (!config || config.host !== '127.0.0.1') {
    throw new Error('The personal gallery server may only bind to 127.0.0.1.')
  }
  const jobs = createJobManager(config, runtime)

  const server = http.createServer(async (request, response) => {
    try {
      const hostHeader = request.headers.host
      if (!isLoopbackHostHeader(hostHeader)) {
        return sendJson(response, 421, { error: 'loopback_host_required' })
      }
      const method = request.method || 'GET'
      const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      if (mutating && !isAllowedMutationRequest(request, hostHeader)) {
        return sendJson(response, 403, { error: 'same_origin_required' })
      }
      if (mutating && !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
        return sendJson(response, 415, { error: 'application_json_required' })
      }
      const url = new URL(request.url || '/', `http://${config.host}:${config.port}`)

      if (method === 'GET' && url.pathname === '/') {
        return sendFile(response, path.join(STATIC_ROOT, 'index.html'), 'text/html; charset=utf-8')
      }
      if (method === 'GET' && (url.pathname.startsWith('/gallery/') || url.pathname === '/gallery')) {
        return sendFile(response, path.join(STATIC_ROOT, 'gallery.html'), 'text/html; charset=utf-8')
      }
      if (method === 'GET' && STATIC_FILES.has(url.pathname)) {
        const [name, contentType] = STATIC_FILES.get(url.pathname)
        return sendFile(response, path.join(STATIC_ROOT, name), contentType)
      }
      if (method === 'GET' && url.pathname === '/api/status') {
        const sourceStatus = typeof runtime.readSourceStatus === 'function'
          ? await runtime.readSourceStatus()
          : null
        const characterConfigs = typeof runtime.listCharacters === 'function'
          ? await runtime.listCharacters()
          : []
        const characters = await Promise.all(characterConfigs.map(async (character) => {
          const gallery = await runtime.loadGalleryByQuery(character.slug)
          return {
            characterId: character.characterId,
            slug: character.slug,
            displayName: character.displayName,
            aliases: character.aliases,
            workNames: character.workNames,
            hasGallery: Boolean(gallery?.products?.length),
            summary: gallery?.summary || null,
          }
        }))
        return sendJson(response, 200, {
          active: jobs.status(),
          recentRuns: await runtime.listRecentRuns(10),
          sourceStatus,
          defaultQuery: config.defaultQuery || '',
          characters,
        })
      }
      if (method === 'GET' && url.pathname === '/api/characters') {
        const characters = typeof runtime.listCharacters === 'function' ? await runtime.listCharacters() : []
        return sendJson(response, 200, { characters })
      }
      if (method === 'POST' && url.pathname === '/api/characters') {
        if (typeof runtime.createCharacter !== 'function') return sendJson(response, 501, { error: 'character_config_not_supported' })
        const character = await runtime.createCharacter(await readBody(request))
        return sendJson(response, 201, { character })
      }
      if (method === 'POST' && url.pathname === '/api/runs') {
        const result = await jobs.start(await readBody(request))
        return sendJson(response, result.statusCode, result)
      }
      if (method === 'POST' && url.pathname === '/api/runs/stop') {
        const result = jobs.stop()
        return sendJson(response, result.stopped ? 202 : 409, result)
      }
      if (method === 'GET' && url.pathname.startsWith('/api/gallery/run/')) {
        const runId = decodeURIComponent(url.pathname.slice('/api/gallery/run/'.length))
        const gallery = await runtime.loadRunGallery(runId)
        return gallery
          ? sendJson(response, 200, gallery)
          : sendJson(response, 404, { error: 'gallery_not_found' })
      }
      if (method === 'GET' && url.pathname.startsWith('/api/gallery/character/')) {
        const query = decodeURIComponent(url.pathname.slice('/api/gallery/character/'.length))
        const gallery = await runtime.loadGalleryByQuery(query)
        return gallery
          ? sendJson(response, 200, gallery)
          : sendJson(response, 404, { error: 'gallery_not_found' })
      }
      if (method === 'POST' && url.pathname.startsWith('/api/preferences/')) {
        const characterSlug = decodeURIComponent(url.pathname.slice('/api/preferences/'.length))
        const body = await readBody(request)
        const preferences = await runtime.savePreferences(characterSlug, body)
        return sendJson(response, 200, { preferences })
      }
      if (method === 'GET' && url.pathname.startsWith('/media/')) {
        const sha256 = url.pathname.slice('/media/'.length)
        const objectPath = await resolveMediaObject(config.root, sha256)
        if (!objectPath) return sendJson(response, 404, { error: 'media_not_found' })
        const extension = path.extname(objectPath).toLowerCase()
        const contentType =
          extension === '.png'
            ? 'image/png'
            : extension === '.webp'
              ? 'image/webp'
              : extension === '.gif'
                ? 'image/gif'
                : 'image/jpeg'
        return sendFile(response, objectPath, contentType)
      }

      return sendJson(response, 404, { error: 'not_found' })
    } catch (error) {
      return sendJson(response, error?.statusCode || 500, { error: safeError(error) })
    }
  })

  return {
    server,
    jobs,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, resolve)
      })
      return server.address()
    },
    async close() {
      if (!server.listening) return
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}
