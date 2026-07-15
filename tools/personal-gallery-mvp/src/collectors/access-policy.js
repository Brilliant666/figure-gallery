const HARD_STATUS = new Set([401, 403, 429])

const BLOCK_PATTERNS = [
  ['captcha', /(?:captcha|hcaptcha|recaptcha|验证码)/iu],
  ['robot_verification', /(?:robot verification|verify (?:that )?you are human|机器人验证|人机验证)/iu],
  ['access_denied', /(?:access denied|request (?:was )?blocked|访问被拒绝|拒绝访问)/iu],
  ['login_required', /(?:login required|sign in to continue|请先登录|登录后(?:继续|访问))/iu],
  ['robots_denied', /(?:robots\.txt[^<]{0,80}(?:disallow|denied|forbidden)|robots (?:policy )?(?:denied|forbidden))/iu],
]

export class CollectionBlockedError extends Error {
  constructor(message, { code = 'blocked', status = null, url = null, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'CollectionBlockedError'
    this.code = code
    this.status = status
    this.url = url
    this.blocked = true
  }
}

export function detectBlockingResult(result, { url = null } = {}) {
  const status = Number(result?.status ?? result?.statusCode)
  if (HARD_STATUS.has(status)) {
    return new CollectionBlockedError(`Collection stopped on HTTP ${status}.`, {
      code: `http_${status}`,
      status,
      url: result?.finalUrl || url,
    })
  }
  if (result?.robotsDenied === true) {
    return new CollectionBlockedError('Collection stopped because robots policy refused access.', {
      code: 'robots_denied',
      status: Number.isFinite(status) ? status : null,
      url: result?.finalUrl || url,
    })
  }
  if (result?.sourceRefused === true) {
    return new CollectionBlockedError('Collection stopped because the source refused access.', {
      code: 'source_refused',
      status: Number.isFinite(status) ? status : null,
      url: result?.finalUrl || url,
    })
  }
  const html = String(result?.rawHtml ?? result?.html ?? '')
  for (const [code, pattern] of BLOCK_PATTERNS) {
    if (pattern.test(html)) {
      return new CollectionBlockedError(`Collection stopped after detecting ${code.replaceAll('_', ' ')}.`, {
        code,
        status: Number.isFinite(status) ? status : null,
        url: result?.finalUrl || url,
      })
    }
  }
  return null
}

export function toCollectionError(error, { url = null } = {}) {
  if (error instanceof CollectionBlockedError) return error
  if (error?.name === 'ProviderBlockedError') {
    return new CollectionBlockedError(error.message, {
      code: error.category || 'source_refused',
      status: error.statusCode ?? null,
      url: error.requestRecord?.finalSourceUrl || url,
      cause: error,
    })
  }
  if (error?.blocked) {
    return new CollectionBlockedError(error.message, {
      code: error.code || 'blocked',
      status: error.status ?? null,
      url: error.url || url,
      cause: error,
    })
  }
  const status = Number(error?.status ?? error?.statusCode)
  if (HARD_STATUS.has(status)) {
    return new CollectionBlockedError(`Collection stopped on HTTP ${status}.`, {
      code: `http_${status}`,
      status,
      url,
      cause: error,
    })
  }
  if (error?.name === 'ProviderRequestError') {
    error.code ||= error.category || 'provider_request_failed'
    error.status ??= error.statusCode ?? null
  }
  return error
}

export function errorFingerprint(error) {
  return String(error?.code || error?.status || error?.name || 'unknown_error')
}
