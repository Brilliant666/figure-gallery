import { createHash } from 'node:crypto'

export function clean(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

export function normalized(value) {
  return clean(value).toLocaleLowerCase('en-US')
}

export function compact(value) {
  return normalized(value).replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

export function unique(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))]
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function containsTerm(value, term) {
  const source = clean(value)
  const target = clean(term)
  if (!target) return false
  if (/^[A-Za-z0-9][A-Za-z0-9 .:_+\-/]*$/u.test(target)) {
    return new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegex(target)}(?:$|[^A-Za-z0-9])`, 'iu').test(source)
  }
  return normalized(source).includes(normalized(target))
}

export function parseScale(value) {
  const match = clean(value).match(/\b1\s*\/\s*\d+\b/u)
  return match ? match[0].replace(/\s/gu, '') : null
}

export function parseHeightMm(value) {
  const matches = [...clean(value).matchAll(/(?:approximately|approx\.?|about)?\s*(\d{2,4})\s*mm/giu)]
  return matches.length ? Number(matches.at(-1)[1]) : null
}

export function decodeHtml(value) {
  return clean(String(value ?? '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;|&#160;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;|&#34;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>'))
}

export function absoluteUrl(base, candidate) {
  if (!candidate) return null
  try {
    return new URL(candidate, base).toString()
  } catch {
    return null
  }
}
