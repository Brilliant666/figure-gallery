import { clean, compact, containsTerm, normalized, unique } from './text.js'

const GENERIC_TITLE_WORDS = new Set([
  'figure', 'figurine', 'statue', 'complete', 'completed', 'painted', 'pvc', 'abs',
  'scale', 'non', 'ver', 'version', 'product', 'pre', 'order', 'prepainted',
  'collectible', 'metal',
])

const GROUPABLE_VARIANT_PATTERNS = [
  /\brenewal(?: package)?\b/giu,
  /\bre-?release\b/giu,
  /\b20\d{2}\s+re-?release\b/giu,
  /\bspecial colou?r\b/giu,
  /\banother colou?r\b/giu,
  /\bpearl(?: colou?r)?\b/giu,
  /\bpastel(?: colou?r)?\b/giu,
  /\bonline crane(?: colou?r)?\b/giu,
  /\bcrane limited\b/giu,
  /\bchannel exclusive\b/giu,
]

function removeTerm(value, term) {
  const target = clean(term)
  if (!target) return value
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')
  return value.replace(new RegExp(`(?:^|[^\\p{Letter}\\p{Number}])${escaped}(?=$|[^\\p{Letter}\\p{Number}])`, 'giu'), ' ')
}

function tokens(value) {
  return normalized(value).split(/[^\p{Letter}\p{Number}]+/gu).filter(Boolean)
}

export function manufacturerKey(value) {
  const cleaned = normalized(value)
  if (cleaned.includes('good smile arts shanghai')) return 'goodsmileartsshanghai'
  if (cleaned === 'apex' || cleaned.includes('apex innovation')) return 'apex'
  return compact(cleaned.replace(/(?:co\.?\s*,?\s*ltd\.?|corporation|company|inc\.?)/giu, ''))
}

export function scaleKey(value) {
  return String(value ?? '').replace(/\s+/gu, '')
}

export function structuralVariantSignature(title) {
  const value = normalized(title)
  const markers = []
  for (const match of value.matchAll(/\b(\d+(?:st|nd|rd|th))\b/gu)) markers.push(match[1])
  for (const match of value.matchAll(/\bver(?:sion)?\s*(\d+)\b/gu)) markers.push(`ver-${match[1]}`)
  for (const term of ['single', 'duo', 'pair', 'bust', 'sitting', 'seated', 'kneeling', 'bunny', 'bare leg']) {
    if (containsTerm(value, term)) markers.push(term)
  }
  return unique(markers).sort().join('|')
}

export function semanticTitle(title, profile, manufacturer = '') {
  let value = clean(title)
  // Normalize observed catalog spelling and compound-word differences before
  // removing profile terms. These are source-format differences, not
  // character-specific grouping rules.
  value = value
    .replace(/\bazure\s+lane\b/giu, 'Azur Lane')
    .replace(/\bchesher\b/giu, 'Cheshire')
    .replace(/\bhappyshake\b/giu, 'Happy Shake')
    .replace(/\bsummery\b/giu, 'Summer')
    .replace(/\btrio\b/giu, 'Set')
  // Parenthesized/bracketed maker labels are catalog decoration, but other
  // parenthetical version names remain meaningful.
  value = value.replace(/[[(]([^\])]+)[\])]/gu, (full, inner) =>
    manufacturer && (manufacturerKey(inner) === manufacturerKey(manufacturer) || manufacturerKey(inner).includes(manufacturerKey(manufacturer))) ? ' ' : full,
  )
  const makerTerms = clean(manufacturer).split(/\s*,\s*|\s+as\s+manufacturer/giu).filter(Boolean)
  for (const term of [...profile.seriesAliases, ...profile.aliases, ...profile.titleStopwords, manufacturer, ...makerTerms]) value = removeTerm(value, term)
  value = value.replace(/\b1\s*\/\s*\d+\b/giu, ' ')
  const hasNendoroid = /\bnendoroid\b/iu.test(value)
  const output = tokens(value).filter((token) =>
    !GENERIC_TITLE_WORDS.has(token) &&
    !/^\d+mm$/u.test(token) &&
    !(hasNendoroid && /^\d{3,}$/u.test(token)),
  )
  return unique(output).join(' ')
}

export function groupingBaseTitle(title, profile, manufacturer = '') {
  let value = semanticTitle(title, profile, manufacturer)
  for (const pattern of GROUPABLE_VARIANT_PATTERNS) value = value.replace(pattern, ' ')
  return tokens(value).filter((token) => !['limited', 'exclusive'].includes(token)).join(' ')
}

export function semanticMergeCompatible(left, right) {
  if (left.sourceRefs[0].family === right.sourceRefs[0].family) return false
  const leftKey = unique(tokens(left.semanticTitle)).sort().join(' ')
  const rightKey = unique(tokens(right.semanticTitle)).sort().join(' ')
  if (!leftKey || leftKey !== rightKey) return false
  if (!left.manufacturerKey || left.manufacturerKey !== right.manufacturerKey) return false
  if (left.scale && right.scale && scaleKey(left.scale) !== scaleKey(right.scale)) return false
  return left.structuralVariantSignature === right.structuralVariantSignature
}
