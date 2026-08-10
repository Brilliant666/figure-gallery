import { setTimeout as delay } from 'node:timers/promises'
import { AccessBlockedError, USER_AGENT, assertAllowedUrl, robotsAllows } from './network-policy.js'

export class PolicyFetcher {
  constructor({ delayMs = 1500, transport = globalThis.fetch, sleep = delay } = {}) {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('delayMs must be a non-negative number.')
    if (typeof transport !== 'function') throw new Error('A fetch-compatible transport is required.')
    this.delayMs = delayMs
    this.transport = transport
    this.sleep = sleep
    this.lastRequestAt = new Map()
    this.robots = new Map()
    this.requestCount = 0
  }

  async #paced(host) {
    const remaining = this.delayMs - (Date.now() - (this.lastRequestAt.get(host) ?? 0))
    if (remaining > 0) await this.sleep(remaining)
  }

  async #raw(url, options = {}, redirects = 0) {
    const checked = assertAllowedUrl(url)
    await this.#paced(checked.host)
    const response = await this.transport(checked, {
      ...options,
      redirect: 'manual',
      headers: {
        accept: options.headers?.accept ?? '*/*',
        'accept-language': 'en',
        'user-agent': USER_AGENT,
        ...options.headers,
      },
    })
    this.requestCount += 1
    this.lastRequestAt.set(checked.host, Date.now())
    if ([401, 403, 429].includes(response.status)) {
      throw new AccessBlockedError(`http_${response.status}`, { url: checked.toString(), status: response.status })
    }
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= 3) throw new AccessBlockedError('redirect_limit', { url: checked.toString(), status: response.status })
      const location = response.headers.get('location')
      if (!location) throw new AccessBlockedError('redirect_without_location', { url: checked.toString(), status: response.status })
      const redirected = assertAllowedUrl(new URL(location, checked).toString())
      if (redirected.hostname !== checked.hostname) throw new AccessBlockedError('redirect_host_change', { url: redirected.toString(), status: response.status })
      return this.#raw(redirected, options, redirects + 1)
    }
    return response
  }

  async #robotsFor(url) {
    const origin = url.origin
    if (this.robots.has(origin)) return this.robots.get(origin)
    const robotsUrl = `${origin}/robots.txt`
    let response
    try {
      response = await this.#raw(robotsUrl, { method: 'GET', headers: { accept: 'text/plain' } })
    } catch (error) {
      if (error instanceof AccessBlockedError) throw error
      throw new AccessBlockedError('robots_unavailable', { url: robotsUrl })
    }
    if (response.status === 404) {
      this.robots.set(origin, null)
      return null
    }
    if (!response.ok) throw new AccessBlockedError('robots_unavailable', { url: robotsUrl, status: response.status })
    const text = await response.text()
    this.robots.set(origin, text)
    return text
  }

  async request(value, { method = 'GET', headers = {}, body } = {}) {
    const url = assertAllowedUrl(value)
    const robots = await this.#robotsFor(url)
    if (robots !== null && !robotsAllows(robots, url)) throw new AccessBlockedError('robots_disallow', { url: url.toString() })
    const response = await this.#raw(url, { method, headers, body })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    return response
  }

  async text(value, options) {
    const response = await this.request(value, options)
    const body = await response.text()
    if (/captcha|access denied|robot verification|verify you are (?:a )?human|sign in to continue/iu.test(body)) {
      throw new AccessBlockedError('access_challenge', { url: response.url || String(value), status: response.status })
    }
    return body
  }

  async json(value, options) {
    const body = await this.text(value, options)
    return JSON.parse(body)
  }

  async postJson(value, payload) {
    return this.json(value, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }
}
