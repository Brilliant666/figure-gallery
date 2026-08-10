import { absoluteUrl, clean, decodeHtml, unique } from './text.js'

function attribute(source, name) {
  const match = String(source).match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu'))
  return match?.[2] ?? ''
}

export function heading(html, preferredId = '') {
  const candidates = [...String(html).matchAll(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/giu)]
  if (preferredId) {
    const preferred = candidates.find((match) => attribute(match[1], 'id') === preferredId)
    if (preferred) return decodeHtml(preferred[2])
  }
  return candidates.length ? decodeHtml(candidates[0][2]) : ''
}

export function detailPairs(html) {
  const output = {}
  const pattern = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/giu
  for (const match of String(html).matchAll(pattern)) {
    const label = decodeHtml(match[1])
    if (label) output[label] = decodeHtml(match[2])
  }
  return output
}

export function imageSources(html, baseUrl, predicate = () => true) {
  const output = []
  for (const match of String(html).matchAll(/<img\b([^>]*)>/giu)) {
    const source = attribute(match[1], 'src') || attribute(match[1], 'data-src')
    const absolute = absoluteUrl(baseUrl, source)
    if (absolute && predicate(absolute, match[1])) output.push(absolute)
  }
  return unique(output)
}

export function anchors(html, baseUrl) {
  const output = []
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const href = absoluteUrl(baseUrl, attribute(match[1], 'href'))
    if (href) output.push({ url: href, label: decodeHtml(match[2]), attributes: clean(match[1]) })
  }
  return output
}

export function classText(html, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const pattern = new RegExp(`<[^>]+class=["'][^"']*${escaped}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'iu')
  return decodeHtml(String(html).match(pattern)?.[1] ?? '')
}
