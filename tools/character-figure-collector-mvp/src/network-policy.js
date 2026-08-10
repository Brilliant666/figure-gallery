const ALLOWED_HOSTS = new Set([
  'solarisjapan.com',
  'www.solarisjapan.com',
  'goodsmile.com',
  'www.goodsmile.com',
  'goodsmile.info',
  'www.goodsmile.info',
  'japan-figure.com',
  'www.japan-figure.com',
])

export const USER_AGENT = 'FigureGalleryCharacterCollectorMVP/0.1 (bounded local catalog validation)'

export class AccessBlockedError extends Error {
  constructor(reason, { url = '', status = null } = {}) {
    super(`Collection blocked: ${reason}${status ? ` (${status})` : ''}${url ? ` ${url}` : ''}`)
    this.name = 'AccessBlockedError'
    this.reason = reason
    this.url = url
    this.status = status
  }
}

export function assertAllowedUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new AccessBlockedError('invalid_url', { url: String(value) })
  }
  const host = url.hostname.toLocaleLowerCase('en-US')
  if (host === 'hpoi.net' || host.endsWith('.hpoi.net')) throw new AccessBlockedError('hpoi_hard_denied', { url: url.toString() })
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(host)) throw new AccessBlockedError('host_not_allowlisted', { url: url.toString() })
  return url
}

function parseGroups(text) {
  const groups = []
  let agents = []
  let rules = []
  let sawRule = false
  const flush = () => {
    if (agents.length) groups.push({ agents, rules })
    agents = []
    rules = []
    sawRule = false
  }
  for (const rawLine of String(text).split(/\r?\n/gu)) {
    const line = rawLine.replace(/#.*$/u, '').trim()
    if (!line) continue
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim().toLocaleLowerCase('en-US')
    const value = line.slice(separator + 1).trim()
    if (key === 'user-agent') {
      if (sawRule) flush()
      agents.push(value.toLocaleLowerCase('en-US'))
    } else if ((key === 'allow' || key === 'disallow') && agents.length) {
      sawRule = true
      rules.push({ type: key, path: value })
    }
  }
  flush()
  return groups
}

export function robotsAllows(text, targetUrl, userAgent = USER_AGENT) {
  const agent = userAgent.toLocaleLowerCase('en-US').split(/[\s/]/u)[0]
  const groups = parseGroups(text)
  const exact = groups.filter((group) => group.agents.some((item) => item !== '*' && agent.includes(item)))
  const selected = exact.length ? exact : groups.filter((group) => group.agents.includes('*'))
  if (!selected.length) return true
  const path = `${targetUrl.pathname}${targetUrl.search}`
  const matches = selected.flatMap((group) => group.rules).filter((rule) => {
    if (!rule.path) return false
    const anchored = rule.path.endsWith('$')
    const source = rule.path.replace(/\$$/u, '').split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*')
    return new RegExp(`^${source}${anchored ? '$' : ''}`, 'u').test(path)
  })
  if (!matches.length) return true
  const specificity = (rule) => rule.path.replace(/[*$]/gu, '').length
  matches.sort((left, right) => specificity(right) - specificity(left) || (left.type === 'allow' ? -1 : 1))
  return matches[0].type === 'allow'
}
