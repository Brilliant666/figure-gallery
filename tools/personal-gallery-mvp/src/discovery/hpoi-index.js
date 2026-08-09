import { createHash } from 'node:crypto'

import {
  conflictingCharacterMatch,
  matchesCharacterText,
  matchesCharacterWork,
  validateCharacterConfig,
} from '../characters/registry.js'
import { isHpoiHost } from '../parsers/official-urls.js'

const TRACKING_PARAMETER = /^(?:from|ref|source|spm|utm_.*)$/iu
const SENSITIVE_PARAMETER = /^(?:access_?token|api_?key|apikey|auth|authorization|cookie|password|secret|session|session_?id|sid|token)$/iu
const HPOI_PRODUCT_PATH = /^\/(?:move\/)?hobby\/(\d+)(?:\/)?$/iu

const IN_SCOPE_PATTERNS = [
  /比例(?:人形|手办|模型)/iu,
  /(?:scale|scaled)\s*figure/iu,
  /スケールフィギュア/iu,
  /(?:完成品|塗装済み完成品).*フィギュア/iu,
  /(?:static|pvc)\s*(?:complete(?:d)?\s*)?figure/iu,
  /(?:景品|プライズ|prize)\s*(?:figure|フィギュア)?/iu,
]

const OUT_OF_SCOPE_PATTERNS = [
  ['nendoroid', /黏土人|粘土人|ねんどろいど|nendoroid/iu],
  ['action_figure', /可动|可動|figma|action\s*figure/iu],
  ['chibi', /Q版|デフォルメ|chibi/iu],
  ['trading_or_blind_box', /盒蛋|食玩|扭蛋|ガチャ|盲盒|blind\s*box|trading\s*figure/iu],
  ['garage_kit', /(?:^|[^A-Za-z])GK(?:$|[^A-Za-z])|garage\s*kit|ガレージキット|未授权|未授權/iu],
  ['non_figure_merchandise', /抱枕|毛绒|ぬいぐるみ|亚克力|アクリル|卡牌|カード|服装|衣装|cosplay|非实体|digital/iu],
]

const MANUFACTURERS = [
  'Good Smile Arts Shanghai',
  'Good Smile Company',
  'KADOKAWA',
  'Wonderful Works',
  'Phat! Company',
  'FREEing',
  'Prime 1 Studio',
  'FuRyu',
  'eStream',
  'SEGA',
  'TAITO',
  'Banpresto',
  'ALTER',
  'ALPHA OMEGA',
  'APEX',
  'AniGame',
  'B-style',
]

export const DISCOVERY_CANDIDATE_STATUSES = Object.freeze([
  'discovered',
  'in_scope',
  'out_of_scope',
  'already_collected',
  'needs_resolution',
  'official_resolved',
  'collected',
  'ambiguous',
])

function uniqueText(values = []) {
  return [...new Set(values.map((value) => String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()).filter(Boolean))]
}

function addBounded(target, value, max) {
  const query = String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (query && !target.includes(query) && target.length < max) target.push(query)
}

function productTermFor(alias, index) {
  if (/^[\p{Script=Han}]+$/u.test(alias)) return ['比例人形', '比例手办', '景品'][index % 3]
  if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(alias)) return ['スケールフィギュア', '完成品フィギュア', 'プライズフィギュア'][index % 3]
  return ['scale figure', 'completed figure', 'prize figure'][index % 3]
}

export function buildHpoiIndexQueries(characterConfig, { maxQueries = 30 } = {}) {
  const character = validateCharacterConfig(characterConfig)
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 30) {
    throw new Error('Hpoi index query limit must be from 1 through 30.')
  }
  const queries = []
  character.aliases.forEach((alias, aliasIndex) => {
    const preferredWork = character.workNames[aliasIndex % character.workNames.length]
    addBounded(queries, `site:hpoi.net "${alias}" "${preferredWork}" ${productTermFor(alias, 0)}`, maxQueries)
    addBounded(queries, `site:hpoi.net "${alias}" "${preferredWork}"`, maxQueries)
    addBounded(queries, `site:hpoi.net "${alias}" ${productTermFor(alias, 1)}`, maxQueries)
  })
  character.workNames.forEach((work, workIndex) => {
    const alias = character.aliases[workIndex % character.aliases.length]
    addBounded(queries, `site:hpoi.net "${alias}" "${work}" ${productTermFor(alias, 2)}`, maxQueries)
  })
  for (const alias of character.aliases) {
    for (const work of character.workNames) {
      addBounded(queries, `site:hpoi.net "${alias}" "${work}" figure`, maxQueries)
    }
  }
  return queries
}

export function normalizeIndexedHpoiUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let parsed
  try { parsed = new URL(value) } catch { return null }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !isHpoiHost(parsed.hostname)) return null
  if ([...parsed.searchParams.keys()].some((key) => SENSITIVE_PARAMETER.test(key))) return null
  const productId = HPOI_PRODUCT_PATH.exec(parsed.pathname.replace(/\/{2,}/gu, '/'))?.[1]
  if (!productId) return null
  const normalizedHost = parsed.hostname.replace(/\.$/u, '').toLowerCase()
  parsed.hostname = normalizedHost === 'hpoi.net' || normalizedHost === 'www.hpoi.net'
    ? 'www.hpoi.net'
    : normalizedHost
  parsed.pathname = `/hobby/${productId}`
  parsed.hash = ''
  for (const key of [...parsed.searchParams.keys()]) if (TRACKING_PARAMETER.test(key)) parsed.searchParams.delete(key)
  parsed.searchParams.sort()
  return parsed.href
}

export function indexedHpoiProductId(value) {
  const normalized = normalizeIndexedHpoiUrl(value)
  return normalized ? HPOI_PRODUCT_PATH.exec(new URL(normalized).pathname)?.[1] || null : null
}

export function discoveryCandidateId(indexedUrl) {
  const normalized = normalizeIndexedHpoiUrl(indexedUrl)
  if (!normalized) throw new Error('Discovery candidate requires an indexed Hpoi product URL.')
  const productId = indexedHpoiProductId(normalized)
  return productId
    ? `hpoi-index-id-${productId}`
    : `hpoi-index-url-${createHash('sha256').update(normalized).digest('hex')}`
}

export function normalizeProductTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/hpoi\s*(?:手办|手辦)?\s*(?:维基|維基)?/giu, ' ')
    .replace(/(?:比例(?:人形|手办|手辦|模型)|スケールフィギュア|完成品フィギュア|scale\s*figure|figure)/giu, ' ')
    .replace(/[「」『』【】\[\]<>《》“”"'`]/gu, ' ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function removeNormalizedPhrase(value, phrase) {
  const normalizedPhrase = normalizeProductTitle(phrase)
  if (!normalizedPhrase) return value
  return value
    .replaceAll(normalizedPhrase, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function inferVariantPhrase(title, characterConfig, { manufacturer = null, scale = null } = {}) {
  const character = validateCharacterConfig(characterConfig)
  let value = normalizeProductTitle(title)
  const removablePhrases = [...character.aliases, ...character.workNames, manufacturer, scale]
    .filter(Boolean)
    .sort((left, right) => normalizeProductTitle(right).length - normalizeProductTitle(left).length)
  for (const phrase of removablePhrases) {
    value = removeNormalizedPhrase(value, phrase)
  }
  return value
    .replace(/\b(?:hpoi)\b/giu, ' ')
    .replace(/(?:手办维基|手办百科|动漫模玩百科资料库|动漫模玩|百科资料库)/gu, ' ')
    .replace(/\b(?:anime|complete(?:d)?|figure|official|product|re|series|static|ver(?:sion)?)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim() || null
}

function inferScale(text) {
  return /(?:^|[^\d])(1\s*[/:]\s*\d{1,2})(?:$|[^\d])/u.exec(text)?.[1]?.replace(/\s+/gu, '').replace(':', '/') || null
}

function inferManufacturer(text) {
  const known = MANUFACTURERS.find((name) => text.toLocaleLowerCase('en-US').includes(name.toLocaleLowerCase('en-US')))
  if (known) return known
  const bracketed = [...text.matchAll(/[\[【]([^\]】]{2,48})[\]】]/gu)]
    .map((match) => match[1].trim())
    .filter((value) => !/hpoi|手办维基|手辦維基/iu.test(value))
  return bracketed.at(-1) || null
}

function inferCategory(text) {
  if (/景品|プライズ|prize/iu.test(text)) return 'prize'
  if (/比例|scale|スケール/iu.test(text)) return 'scale'
  if (/完成品|static|pvc/iu.test(text)) return 'static'
  return null
}

export function classifyIndexedCandidate({ titleHint, snippetHint }, characterConfig) {
  const character = validateCharacterConfig(characterConfig)
  const text = uniqueText([titleHint, snippetHint]).join(' ')
  const conflictingAlias = conflictingCharacterMatch(text, character)
  if (conflictingAlias) return { status: 'out_of_scope', reason: `different_character_${conflictingAlias}` }
  const characterMatch = matchesCharacterText(text, character)
  const workMatch = matchesCharacterWork(text, character)
  if (!characterMatch || !workMatch) {
    return {
      status: 'ambiguous',
      reason: !characterMatch && !workMatch
        ? 'character_and_work_evidence_missing'
        : !characterMatch ? 'character_evidence_missing' : 'work_evidence_missing',
    }
  }
  for (const [reason, pattern] of OUT_OF_SCOPE_PATTERNS) {
    if (pattern.test(text)) return { status: 'out_of_scope', reason }
  }
  if (IN_SCOPE_PATTERNS.some((pattern) => pattern.test(text))) return { status: 'in_scope', reason: 'character_work_and_scope_evidence' }
  return { status: 'ambiguous', reason: 'figure_scope_evidence_incomplete' }
}

export function createDiscoveryCandidate(entry, characterConfig) {
  const character = validateCharacterConfig(characterConfig)
  const indexedUrl = normalizeIndexedHpoiUrl(entry?.indexedUrl || entry?.url)
  if (!indexedUrl) return null
  const titleHint = String(entry?.titleHint || entry?.title || '').normalize('NFKC').trim() || null
  const snippetHint = String(entry?.snippetHint || entry?.description || '').normalize('NFKC').trim() || null
  const combined = [titleHint, snippetHint].filter(Boolean).join(' ')
  const classification = classifyIndexedCandidate({ titleHint, snippetHint }, character)
  const manufacturerHint = inferManufacturer(combined)
  const scaleHint = inferScale(combined)
  const categoryHint = inferCategory(combined)
  const normalizedTitle = normalizeProductTitle(titleHint)
  const variantHint = inferVariantPhrase(titleHint, character, {
    manufacturer: manufacturerHint,
    scale: scaleHint,
  })
  return {
    schemaVersion: 1,
    candidateId: discoveryCandidateId(indexedUrl),
    characterId: character.characterId,
    characterSlug: character.slug,
    discoverySource: 'hpoi_search_index',
    indexedUrl,
    indexedProductId: indexedHpoiProductId(indexedUrl),
    titleHint,
    snippetHint,
    manufacturerHint,
    categoryHint,
    scaleHint,
    workHint: character.workNames.find((work) => String(combined).normalize('NFKC').toLocaleLowerCase('en-US').includes(work.normalize('NFKC').toLocaleLowerCase('en-US'))) || null,
    discoveryQuery: String(entry?.query || entry?.discoveryQuery || '').trim() || null,
    rank: Number.isInteger(Number(entry?.rank)) ? Number(entry.rank) : null,
    searchProvider: String(entry?.searchProvider || 'firecrawl_search_v2'),
    confidence: Math.max(0, Math.min(1, Number(entry?.confidence ?? (classification.status === 'in_scope' ? 0.9 : 0.5)))),
    status: classification.status,
    statusReason: classification.reason,
    matchKind: null,
    matchedProductId: null,
    resolutionEvidence: [],
    variantHint,
    prototypeHint: [manufacturerHint, normalizedTitle, scaleHint, categoryHint].filter(Boolean).join('|') || null,
  }
}
