#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..')
const DEFAULT_COLLECTOR_ROOT = process.env.REM_COLLECTOR_ROOT || null
const DEFAULT_PROJECTION_CANDIDATES = [
  process.env.REM_PROJECTION_PATH || null,
  path.join(REPOSITORY_ROOT, '.local', 'personal-gallery', 'characters', 'rem', 'prototype-projection.json'),
].filter(Boolean)
const OUTPUT_DIRECTORY = path.join(REPOSITORY_ROOT, 'research', 'evidence', 'rem-prototype-final-audit')
const JSON_OUTPUT = path.join(OUTPUT_DIRECTORY, 'prototype-final-audit-candidates.json')
const HTML_OUTPUT = path.join(SCRIPT_DIRECTORY, 'prototype-final-audit-board.html')

const EXPECTED_BASELINE = Object.freeze({
  sourceCatalogItemCount: 285,
  projectionEligibleItemCount: 284,
  prototypeCount: 231,
  singletonPrototypeCount: 189,
  multiItemPrototypeCount: 42,
  catalogItemsCollapsed: 53,
  groupingConflictCount: 0,
})

const VERSION_PATTERNS = Object.freeze([
  ['PURE_COLOR_VARIANT', /\b(?:another\s+colou?r|special\s+colou?r|pearl(?:\s+colou?r)?|pastel(?:\s+colou?r)?|repaint|bicolou?r|antique(?:\s+ver(?:sion)?)?|blue\s+ver(?:sion)?|white\s+pearl(?:\s+colou?r)?|glass\s+edition)\b/giu],
  ['RERELEASE_RENEWAL', /\b(?:renewal(?:\s+package)?|renewed|re[-\s]?release|rerelease|20\d{2}\s+re[-\s]?release)\b/giu],
  ['CHANNEL_VARIANT', /\b(?:online\s+crane|crane\s+(?:online|limited)|taito\s+(?:online\s+)?crane|shop\s+exclusive|channel\s+exclusive|wf\s+limited|limited\s+edition|last\s+one)\b/giu],
  ['MINOR_EXPRESSION_ACCESSORY', /\b(?:smiling|new\s+year|clear\s+ver(?:sion)?)\b/giu],
])

const PRODUCT_LINES = Object.freeze([
  ['glitter-glamours', /\bglitter\s+(?:&|and)\s+glamours\b/iu],
  ['relax-time', /\brelax\s+time\b/iu],
  ['coreful', /\bcoreful\b/iu],
  ['precious-figure', /\bprecious\s+figure\b/iu],
  ['desktop-cute', /\bdesktop\s+cute\b/iu],
  ['artist-masterpiece', /\b(?:artist\s+masterpiece|amp)\b/iu],
  ['aqua-float-girls', /\baqua\s+float\s+girls\b/iu],
  ['bicute-bunnies', /\bbicute\s+bunnies\b/iu],
  ['trio-try-it', /\btrio\s*[- ]?\s*try\s*[- ]?\s*it\b/iu],
  ['exceed-creative', /\b(?:exceed|exc\s*d)\s+creative\b/iu],
  ['luminasta', /\bluminasta\b/iu],
  ['pm-spm-lpm', /\b(?:pm|spm|lpm)\s+figure\b/iu],
  ['ichiban-kuji', /\bichiban\s+kuji\b/iu],
  ['freeing-bunny', /\bbunny\s+ver(?:sion)?\b/iu],
  ['noodle-stopper', /\bnoodle\s+stopper\b/iu],
  ['super-special-series', /\b(?:super\s+special\s+series|sss)\b/iu],
  ['serenus-couture', /\bserenus\s+couture\b/iu],
  ['espresto', /\bespresto\b/iu],
  ['f-nex', /\bf\s*[:\-]?\s*nex\b/iu],
  ['kdcolle', /\bkd\s*colle\b/iu],
  ['tenitol', /\btenitol\b/iu],
])

const LINE_TOKENS = new Set([
  'glitter', 'glamours', 'relax', 'time', 'coreful', 'precious', 'desktop', 'cute',
  'artist', 'masterpiece', 'aqua', 'float', 'girls', 'bicute', 'bunnies', 'trio',
  'try', 'it', 'exceed', 'creative', 'luminasta', 'pm', 'spm', 'lpm', 'ichiban',
  'kuji', 'bunny', 'noodle', 'stopper', 'super', 'special', 'series', 'sss',
  'serenus', 'couture', 'espresto', 'f', 'nex', 'kdcolle', 'kd', 'colle', 'tenitol',
])

const STOP_TOKENS = new Set([
  'rem', 'ram', 're', 'zero', 'kara', 'hajimeru', 'isekai', 'seikatsu', 'starting',
  'life', 'in', 'another', 'world', 'memory', 'snow', 'figure', 'figures', 'ver',
  'version', 'edition', 'shop', 'exclusive', 'prize', 'collectible', 'collectable',
  'the', 'a', 'an', 'and', 'of', 'for', 'with', 'as', 'manufacturer', 'producer',
  'company', 'corporation', 'ltd', 'scale', 'game', 'original',
])

const MANUFACTURER_FAMILIES = Object.freeze([
  ['bandai', /\b(?:bandai|bandai spirits|banpresto)\b/iu],
  ['sega', /\b(?:sega|sega fave|sega ltd)\b/iu],
  ['furyu', /\b(?:furyu|f:nex|f nex)\b/iu],
  ['kadokawa', /\b(?:kadokawa|kdcolle|kd colle)\b/iu],
  ['taito', /\btaito\b/iu],
  ['freeing', /\bfreeing\b/iu],
])

function parseArguments(argv) {
  const output = { collectorRoot: DEFAULT_COLLECTOR_ROOT, projection: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--collector-root') output.collectorRoot = argv[++index]
    else if (argument === '--projection') output.projection = argv[++index]
    else if (argument === '--help') {
      console.log('Usage: node analyze-residual-duplicates.mjs [--projection FILE] [--collector-root DIR]')
      process.exit(0)
    } else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!output.collectorRoot) {
    throw new Error('Collector root is required: pass --collector-root DIR or set REM_COLLECTOR_ROOT.')
  }
  return output
}

async function firstReadable(paths) {
  for (const candidate of paths) {
    try {
      await readFile(candidate)
      return candidate
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`No readable Projection found. Checked:\n${paths.join('\n')}`)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function readJsonWithDigest(file) {
  const buffer = await readFile(file)
  return { value: JSON.parse(buffer.toString('utf8')), sha256: sha256(buffer), bytes: buffer.length }
}

function foldText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/∞/gu, ' infinity ')
    .replace(/×/gu, ' x ')
    .replace(/&/gu, ' and ')
    .toLowerCase()
}

function manufacturerFamily(prototype) {
  const value = prototype.manufacturers?.join(' ') || prototype.manufacturer || ''
  for (const [family, pattern] of MANUFACTURER_FAMILIES) {
    if (pattern.test(value)) return family
  }
  return foldText(value).replace(/[^a-z0-9]+/gu, ' ').trim() || 'unknown'
}

function extractVersionSignals(titles) {
  const signals = []
  const joined = titles.join(' | ')
  for (const [kind, pattern] of VERSION_PATTERNS) {
    pattern.lastIndex = 0
    const matches = [...joined.matchAll(pattern)].map((match) => match[0].trim())
    if (matches.length) signals.push({ kind, matches: [...new Set(matches)] })
  }
  return signals
}

function productLines(titles) {
  const joined = titles.join(' | ')
  return PRODUCT_LINES.filter(([, pattern]) => pattern.test(joined)).map(([line]) => line)
}

function stripVersionPhrases(value) {
  let output = value
  for (const [, pattern] of VERSION_PATTERNS) {
    pattern.lastIndex = 0
    output = output.replace(pattern, ' ')
  }
  return output
    .replace(/\b(?:black|white|blue|purple|red|pink|pastel|pearl|clear|antique)\b/giu, ' ')
    .replace(/\b20\d{2}\b(?=\s*(?:re[-\s]?release|renewal))/giu, ' ')
}

function normalizedTokens(value, prototype) {
  let folded = foldText(value)
  folded = folded
    .replace(/\[[^\]]*(?:shop|exclusive|limited)[^\]]*\]/gu, ' ')
    .replace(/re\s*:\s*zero/gu, ' ')
    .replace(/\b\d+\s*\/\s*\d+(?:st|nd|rd|th)?\b/gu, ' ')
  folded = stripVersionPhrases(folded)
  for (const manufacturer of prototype.manufacturers || [prototype.manufacturer]) {
    const words = foldText(manufacturer).split(/[^a-z0-9]+/gu).filter(Boolean)
    for (const word of words) {
      if (word.length >= 4) folded = folded.replace(new RegExp(`\\b${word}\\b`, 'gu'), ' ')
    }
  }
  return folded
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter((token) => token && !STOP_TOKENS.has(token) && !/^\d+$/u.test(token))
}

function unique(values) {
  return [...new Set(values)]
}

function dice(left, right) {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let intersection = 0
  for (const value of leftSet) if (rightSet.has(value)) intersection += 1
  return (2 * intersection) / (leftSet.size + rightSet.size || 1)
}

function maximumSimilarity(leftVariants, rightVariants) {
  let best = { dice: 0, commonTokens: [], left: [], right: [] }
  for (const left of leftVariants) {
    for (const right of rightVariants) {
      const score = dice(left, right)
      if (score > best.dice) {
        best = {
          dice: score,
          commonTokens: left.filter((token) => right.includes(token)),
          left,
          right,
        }
      }
    }
  }
  return best
}

function compositionHint(prototype) {
  const text = foldText(prototype.catalogItems.map((item) => item.title).join(' | '))
  const hasOtherNamedCharacter = /\b(?:ram|subaru|emilia|childhood\s+rem)\b/iu.test(text)
  const setLike = /\b(?:set\s+of\s+2|complete\s+set|celebration\s+set|twins\s+ver)\b/iu.test(text)
  return hasOtherNamedCharacter || setLike ? 'multi_or_set' : 'single_or_unspecified'
}

function summarizePrototype(prototype) {
  const catalogTitles = prototype.catalogItems.map((item) => item.title)
  const tokenVariants = catalogTitles.map((title) => normalizedTokens(title, prototype))
  const descriptorVariants = tokenVariants.map((tokens) => tokens.filter((token) => !LINE_TOKENS.has(token)))
  return {
    prototypeId: prototype.prototypeId,
    title: prototype.title,
    manufacturer: prototype.manufacturer || null,
    manufacturers: prototype.manufacturers || [],
    manufacturerFamily: manufacturerFamily(prototype),
    classification: prototype.classification,
    category: prototype.category || null,
    compositionHint: compositionHint(prototype),
    versionSignals: extractVersionSignals(catalogTitles),
    productLines: productLines(catalogTitles),
    tokenVariants,
    descriptorVariants,
    catalogItems: prototype.catalogItems.map((item) => ({
      id: item.id,
      title: item.title,
      manufacturer: item.manufacturer || null,
      category: item.category || null,
      classification: item.classification || null,
      scale: item.scale || null,
      release: item.release || null,
      sourceUrls: item.sourceUrls || [],
    })),
    representativeImages: (prototype.images || []).slice(0, 6).map((image) => ({
      url: image.url,
      sourceFamily: image.sourceFamily,
      catalogItemId: image.catalogItemId,
      isMain: image.isMain === true,
    })),
  }
}

function exactVariantMatch(leftVariants, rightVariants, { allowEmpty = false } = {}) {
  for (const left of leftVariants) {
    for (const right of rightVariants) {
      if ((!allowEmpty && (!left.length || !right.length)) || left.length !== right.length) continue
      if (left.every((token, index) => token === right[index])) return true
    }
  }
  return false
}

function pairCandidate(left, right) {
  const sameFamily = left.manufacturerFamily === right.manufacturerFamily
  const sharedLines = left.productLines.filter((line) => right.productLines.includes(line))
  const tokenSimilarity = maximumSimilarity(left.tokenVariants, right.tokenVariants)
  const descriptorSimilarity = maximumSimilarity(left.descriptorVariants, right.descriptorVariants)
  const versionKinds = unique([
    ...left.versionSignals.map((signal) => signal.kind),
    ...right.versionSignals.map((signal) => signal.kind),
  ])
  const hasVersionSignal = versionKinds.length > 0
  const tokenExact = exactVariantMatch(left.tokenVariants, right.tokenVariants)
  const descriptorExact = exactVariantMatch(left.descriptorVariants, right.descriptorVariants, { allowEmpty: true })
  const nonEmptyDescriptorExact = left.descriptorVariants.some((candidate) => (
    candidate.length > 0 && right.descriptorVariants.some((other) => (
      candidate.length === other.length && candidate.every((token, index) => token === other[index])
    ))
  ))
  const reasons = []

  if (tokenExact && (sameFamily || hasVersionSignal)) reasons.push('NORMALIZED_TITLE_MATCH')
  if (sameFamily && nonEmptyDescriptorExact) reasons.push('NORMALIZED_DESCRIPTOR_MATCH')
  if (sharedLines.length && descriptorExact && (sameFamily || hasVersionSignal)) {
    reasons.push('SAME_LINE_VARIANT')
  }
  if (
    sameFamily && hasVersionSignal && descriptorSimilarity.dice >= 0.66 &&
    descriptorSimilarity.commonTokens.length >= 1
  ) reasons.push('VERSION_WORD_NEAR_MATCH')
  if (
    sameFamily && hasVersionSignal &&
    left.descriptorVariants.some((candidate) => candidate.length >= 2 && right.descriptorVariants.some((other) => (
      other.length >= 2 && (
        candidate.every((token) => other.includes(token)) || other.every((token) => candidate.includes(token))
      )
    )))
  ) reasons.push('VERSION_CORE_CONTAINMENT')
  if (
    sharedLines.includes('serenus-couture') && sameFamily
  ) reasons.push('HIGH_RISK_SERIES_INVENTORY')
  if (
    sharedLines.includes('freeing-bunny') && sameFamily &&
    left.descriptorVariants.some((tokens) => right.descriptorVariants.some((other) => (
      tokens.filter((token) => token !== '2nd').join(' ') === other.filter((token) => token !== '2nd').join(' ')
    )))
  ) reasons.push('BUNNY_VERSION_NEAR_MATCH')

  if (!reasons.length) return null
  const confidenceOrder = {
    NORMALIZED_TITLE_MATCH: 4,
    NORMALIZED_DESCRIPTOR_MATCH: 4,
    SAME_LINE_VARIANT: 3,
    VERSION_CORE_CONTAINMENT: 2,
    VERSION_WORD_NEAR_MATCH: 2,
    HIGH_RISK_SERIES_INVENTORY: 1,
    BUNNY_VERSION_NEAR_MATCH: 1,
  }
  const score = Math.max(...reasons.map((reason) => confidenceOrder[reason])) + tokenSimilarity.dice
  return {
    reasons: unique(reasons),
    score: Number(score.toFixed(4)),
    sharedLines,
    versionKinds,
    sameManufacturerFamily: sameFamily,
    compositionMismatch: left.compositionHint !== right.compositionHint,
    tokenSimilarity: Number(tokenSimilarity.dice.toFixed(4)),
    descriptorSimilarity: Number(descriptorSimilarity.dice.toFixed(4)),
    commonTokens: unique(tokenSimilarity.commonTokens),
    commonDescriptorTokens: unique(descriptorSimilarity.commonTokens),
  }
}

function connectedCandidateGroups(pairs) {
  const adjacency = new Map()
  for (const pair of pairs) {
    for (const id of pair.prototypeIds) if (!adjacency.has(id)) adjacency.set(id, new Set())
    adjacency.get(pair.prototypeIds[0]).add(pair.prototypeIds[1])
    adjacency.get(pair.prototypeIds[1]).add(pair.prototypeIds[0])
  }
  const visited = new Set()
  const groups = []
  for (const start of [...adjacency.keys()].sort()) {
    if (visited.has(start)) continue
    const queue = [start]
    const prototypeIds = []
    visited.add(start)
    while (queue.length) {
      const current = queue.shift()
      prototypeIds.push(current)
      for (const neighbor of adjacency.get(current)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    const pairIds = pairs
      .filter((pair) => pair.prototypeIds.every((id) => prototypeIds.includes(id)))
      .map((pair) => pair.candidateId)
    groups.push({
      candidateGroupId: `residual-group-${String(groups.length + 1).padStart(3, '0')}`,
      prototypeIds: prototypeIds.sort(),
      pairIds,
    })
  }
  return groups
}

function highRiskSeriesInventory(prototypes) {
  const requestedLines = new Set([
    'glitter-glamours', 'relax-time', 'coreful', 'precious-figure', 'desktop-cute',
    'artist-masterpiece', 'aqua-float-girls', 'bicute-bunnies', 'trio-try-it',
    'exceed-creative', 'luminasta', 'pm-spm-lpm', 'ichiban-kuji', 'freeing-bunny',
  ])
  return [...requestedLines]
    .map((line) => ({
      line,
      prototypes: prototypes
        .filter((prototype) => prototype.productLines.includes(line))
        .map((prototype) => ({
          prototypeId: prototype.prototypeId,
          title: prototype.title,
          manufacturer: prototype.manufacturer,
          cover: prototype.representativeImages[0]?.url || null,
        })),
    }))
    .filter((entry) => entry.prototypes.length)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function prototypeHtml(prototype) {
  const images = prototype.representativeImages.length
    ? prototype.representativeImages.map((image) => `
      <figure>
        <img loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(image.url)}" alt="${escapeHtml(prototype.title)}">
        <figcaption>${escapeHtml(image.sourceFamily)} · ${escapeHtml(image.catalogItemId)}</figcaption>
      </figure>`).join('')
    : '<p class="missing">No existing image URL</p>'
  const items = prototype.catalogItems.map((item) => `
    <li><code>${escapeHtml(item.id)}</code> — ${escapeHtml(item.title)}</li>`).join('')
  const signals = prototype.versionSignals.map((signal) => (
    `${escapeHtml(signal.kind)}: ${escapeHtml(signal.matches.join(', '))}`
  )).join('<br>') || 'none'
  return `
    <section class="prototype">
      <h3>${escapeHtml(prototype.title)}</h3>
      <dl>
        <dt>prototypeId</dt><dd><code>${escapeHtml(prototype.prototypeId)}</code></dd>
        <dt>manufacturer</dt><dd>${escapeHtml(prototype.manufacturer)} (${escapeHtml(prototype.manufacturerFamily)})</dd>
        <dt>type</dt><dd>${escapeHtml(prototype.classification)} / ${escapeHtml(prototype.category)}</dd>
        <dt>composition</dt><dd>${escapeHtml(prototype.compositionHint)}</dd>
        <dt>version signals</dt><dd>${signals}</dd>
      </dl>
      <div class="images">${images}</div>
      <details open><summary>Catalog Items (${prototype.catalogItems.length})</summary><ul>${items}</ul></details>
    </section>`
}

function renderBoard(document) {
  const pairs = document.candidatePairs.map((pair, index) => `
    <article class="candidate" id="${escapeHtml(pair.candidateId)}">
      <header>
        <span class="counter">${index + 1} / ${document.candidatePairs.length}</span>
        <h2>${escapeHtml(pair.candidateId)}</h2>
        <p><strong>Reasons:</strong> ${escapeHtml(pair.signals.reasons.join(', '))}</p>
        <p><strong>Shared lines:</strong> ${escapeHtml(pair.signals.sharedLines.join(', ') || 'none')} ·
          <strong>version kinds:</strong> ${escapeHtml(pair.signals.versionKinds.join(', ') || 'none')} ·
          <strong>token dice:</strong> ${pair.signals.tokenSimilarity} ·
          <strong>descriptor dice:</strong> ${pair.signals.descriptorSimilarity} ·
          <strong>composition mismatch:</strong> ${pair.signals.compositionMismatch}</p>
        <label>Manual decision
          <select data-decision="${escapeHtml(pair.candidateId)}">
            <option value="">UNREVIEWED</option>
            <option>CONFIRMED_SAME_POSE</option>
            <option>CONFIRMED_DIFFERENT_POSE</option>
            <option>UNCERTAIN</option>
          </select>
        </label>
        <label>Reason <textarea data-reason="${escapeHtml(pair.candidateId)}" rows="2"></textarea></label>
      </header>
      <div class="comparison">${pair.prototypes.map(prototypeHtml).join('')}</div>
    </article>`).join('')
  const inventories = document.highRiskSeriesInventory.map((entry) => `
    <details class="inventory"><summary>${escapeHtml(entry.line)} (${entry.prototypes.length})</summary>
      <div class="inventory-grid">${entry.prototypes.map((prototype) => `
        <div><img loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(prototype.cover || '')}" alt="">
          <code>${escapeHtml(prototype.prototypeId)}</code><p>${escapeHtml(prototype.title)}</p></div>`).join('')}</div>
    </details>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rem residual duplicate candidate audit</title>
<style>
:root{font-family:system-ui,sans-serif;color:#1d2433;background:#f3f5f8}body{margin:0}main{max-width:1500px;margin:auto;padding:24px}h1{margin:.2em 0}.notice{background:#fff6cf;border:1px solid #d4b94b;padding:12px;border-radius:10px}.candidate{background:#fff;margin:24px 0;border:1px solid #ccd3df;border-radius:14px;overflow:hidden}.candidate>header{padding:16px;background:#eef2f8}.candidate label{display:block;margin-top:10px}.candidate select,.candidate textarea{display:block;width:100%;max-width:720px;margin-top:4px}.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#ccd3df}.prototype{background:white;padding:16px;min-width:0}.prototype dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 10px}.prototype dd{margin:0;overflow-wrap:anywhere}.images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.images figure{margin:0}.images img{width:100%;height:220px;object-fit:contain;background:#f7f7f7}.images figcaption{font-size:11px;overflow-wrap:anywhere}.prototype li{margin:.4em 0}.inventory{background:#fff;padding:12px;margin:12px 0;border-radius:10px}.inventory-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:10px}.inventory-grid img{width:100%;height:140px;object-fit:contain;background:#f7f7f7}.inventory-grid code,.inventory-grid p{font-size:11px;overflow-wrap:anywhere}.toolbar{position:sticky;top:0;background:#1d2433;color:white;padding:10px;z-index:2}.toolbar button{margin-right:8px}.counter{float:right}@media(max-width:900px){.comparison{grid-template-columns:1fr}.inventory-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:560px){main{padding:10px}.images{grid-template-columns:repeat(2,minmax(0,1fr))}.inventory-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body><div class="toolbar"><button id="export">Export manual decisions</button><button id="clear">Clear local decisions</button><span id="progress"></span></div>
<main><h1>Rem Prototype residual duplicate audit</h1>
<p class="notice"><strong>Candidate generation only.</strong> Similar text or line membership is not a SAME decision. Inspect sculpture, pose, silhouette and composition visually. Images are existing remote URLs and are not embedded.</p>
<p>Frozen Projection: ${document.currentFacts.prototypeCount} prototypes; candidate pairs: ${document.candidatePairs.length}; connected candidate groups: ${document.candidateGroups.length}. Generated ${escapeHtml(document.generatedAt)}.</p>
<h2>Residual candidate pairs</h2>${pairs}
<h2>High-risk series inventory (manual scan aid, not candidate truth)</h2>${inventories}
</main><script>
const key='rem-prototype-final-audit-decisions-v1';
const read=()=>JSON.parse(localStorage.getItem(key)||'{}');
const save=()=>{const data={};document.querySelectorAll('[data-decision]').forEach(select=>{const id=select.dataset.decision;data[id]={decision:select.value,reason:document.querySelector('[data-reason="'+id+'"]').value};});localStorage.setItem(key,JSON.stringify(data));progress()};
const restore=()=>{const data=read();for(const [id,value] of Object.entries(data)){const select=document.querySelector('[data-decision="'+id+'"]');const reason=document.querySelector('[data-reason="'+id+'"]');if(select)select.value=value.decision||'';if(reason)reason.value=value.reason||'';}progress()};
const progress=()=>{const values=[...document.querySelectorAll('[data-decision]')].map(x=>x.value);document.getElementById('progress').textContent='Reviewed '+values.filter(Boolean).length+' / '+values.length};
document.addEventListener('change',save);document.addEventListener('input',e=>{if(e.target.matches('[data-reason]'))save()});
document.getElementById('clear').onclick=()=>{if(confirm('Clear local audit decisions?')){localStorage.removeItem(key);location.reload()}};
document.getElementById('export').onclick=()=>{save();const blob=new Blob([JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),decisions:read()},null,2)+'\\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='prototype-final-audit-manual-decisions.json';a.click();URL.revokeObjectURL(a.href)};restore();
</script></body></html>`
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const projectionPath = options.projection || await firstReadable(DEFAULT_PROJECTION_CANDIDATES)
  const collectorFiles = {
    figures: path.join(options.collectorRoot, 'figures.json'),
    grouping: path.join(options.collectorRoot, 'prototype-grouping-results.json'),
    imageEvidence: path.join(options.collectorRoot, 'prototype-review-image-evidence.json'),
  }
  const projectionInput = await readJsonWithDigest(projectionPath)
  const figuresInput = await readJsonWithDigest(collectorFiles.figures)
  const groupingInput = await readJsonWithDigest(collectorFiles.grouping)
  const imageEvidenceInput = await readJsonWithDigest(collectorFiles.imageEvidence)
  const projection = projectionInput.value

  for (const [field, expected] of Object.entries(EXPECTED_BASELINE)) {
    if (Number(projection[field]) !== expected) {
      throw new Error(`Frozen Projection mismatch for ${field}: ${projection[field]} != ${expected}`)
    }
  }
  if (projection.prototypes.length !== EXPECTED_BASELINE.prototypeCount) {
    throw new Error('Projection prototype array does not match the frozen count.')
  }
  if (figuresInput.value.items?.length !== 285 || groupingInput.value.pairDecisions?.length !== 137 || imageEvidenceInput.value.reviewPairs?.length !== 35) {
    throw new Error('Frozen Collector inputs do not match the audit baseline.')
  }
  const hpoiImages = projection.prototypes.flatMap((prototype) => prototype.images || [])
    .filter((image) => /(?:^|\.)hpoi\.net$/iu.test(new URL(image.url).hostname))
  if (hpoiImages.length) throw new Error('Hpoi image URLs are forbidden in this audit board.')

  const prototypes = projection.prototypes.map(summarizePrototype)
  const candidatePairs = []
  for (let leftIndex = 0; leftIndex < prototypes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < prototypes.length; rightIndex += 1) {
      const left = prototypes[leftIndex]
      const right = prototypes[rightIndex]
      const signals = pairCandidate(left, right)
      if (!signals) continue
      candidatePairs.push({
        candidateId: '',
        prototypeIds: [left.prototypeId, right.prototypeId],
        signals,
        decision: null,
        manualReason: null,
        prototypes: [left, right],
      })
    }
  }
  candidatePairs.sort((left, right) => (
    right.signals.score - left.signals.score ||
    left.prototypeIds.join('|').localeCompare(right.prototypeIds.join('|'))
  ))
  candidatePairs.forEach((pair, index) => {
    pair.candidateId = `residual-pair-${String(index + 1).padStart(3, '0')}`
  })

  const document = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    auditScope: 'high-recall residual false-split candidates; no grouping mutation or automated truth',
    inputs: {
      projection: {
        path: '.local/personal-gallery/characters/rem/prototype-projection.json (PR #21 runtime, external worktree)',
        sha256: projectionInput.sha256,
        bytes: projectionInput.bytes,
      },
      figures: {
        path: 'rem-figure-collector/figures.json (external read-only)',
        sha256: figuresInput.sha256,
        bytes: figuresInput.bytes,
      },
      grouping: {
        path: 'rem-figure-collector/prototype-grouping-results.json (external read-only)',
        sha256: groupingInput.sha256,
        bytes: groupingInput.bytes,
      },
      imageEvidence: {
        path: 'rem-figure-collector/prototype-review-image-evidence.json (external read-only)',
        sha256: imageEvidenceInput.sha256,
        bytes: imageEvidenceInput.bytes,
      },
    },
    currentFacts: { ...EXPECTED_BASELINE, prototypeCards: projection.prototypes.length },
    algorithm: {
      usesOnlyFrozenLocalJson: true,
      networkRequests: 0,
      imageAlgorithms: [],
      mutatesProjection: false,
      signals: ['manufacturer family', 'version words', 'normalized title', 'product line', 'descriptor token similarity'],
      finalDecisionAuthority: 'manual visual inspection only',
      limitations: [
        'High recall text candidates include intentional dangerous negatives.',
        'No image bytes, pHash, CLIP, embedding, OCR, LLM or visual clustering are used.',
        'The high-risk series inventory is a scan aid and does not imply pair candidacy.',
      ],
    },
    candidatePairCount: candidatePairs.length,
    candidateGroupCount: 0,
    candidatePairs,
    candidateGroups: connectedCandidateGroups(candidatePairs),
    highRiskSeriesInventory: highRiskSeriesInventory(prototypes),
  }
  document.candidateGroupCount = document.candidateGroups.length

  await mkdir(OUTPUT_DIRECTORY, { recursive: true })
  await writeFile(JSON_OUTPUT, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await writeFile(HTML_OUTPUT, `${renderBoard(document)}\n`, 'utf8')
  console.log(JSON.stringify({
    projection: projectionPath,
    candidatePairs: document.candidatePairCount,
    candidateGroups: document.candidateGroupCount,
    jsonOutput: JSON_OUTPUT,
    htmlOutput: HTML_OUTPUT,
  }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
