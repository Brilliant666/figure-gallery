const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1) || '')
const characterName = document.querySelector('#character-name')
const galleryLink = document.querySelector('#gallery-link')
const metricsRoot = document.querySelector('#coverage-metrics')
const ratesRoot = document.querySelector('#coverage-rates')
const rowsRoot = document.querySelector('#candidate-rows')
const countRoot = document.querySelector('#candidate-count')

const METRICS = [
  ['hpoiIndexedCandidates', 'Hpoi-index candidates'],
  ['inScope', 'In scope'],
  ['alreadyCollected', 'Already collected'],
  ['newTargets', 'New target'],
  ['officialResolved', 'Official resolved'],
  ['collected', 'Collected'],
  ['unresolved', 'Unresolved'],
  ['outOfScope', 'Out of scope'],
  ['ambiguous', 'Ambiguous'],
]

function text(value, fallback = '—') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function percent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : 'n/a'
}

function renderMetrics(coverage) {
  metricsRoot.replaceChildren()
  const metrics = coverage?.metrics || {}
  for (const [key, label] of METRICS) {
    const item = document.createElement('div')
    const term = document.createElement('dt')
    const value = document.createElement('dd')
    term.textContent = label
    value.textContent = String(metrics[key] || 0)
    item.append(term, value)
    metricsRoot.append(item)
  }
  ratesRoot.textContent = coverage
    ? `正式来源解析率 ${percent(metrics.resolutionRate)} · 新目标收录率 ${percent(metrics.collectionRate)} · 当前索引候选已有覆盖率 ${percent(metrics.existingCoverageRate)}`
    : '尚无索引发现记录。'
}

function renderCandidates(candidates) {
  rowsRoot.replaceChildren()
  countRoot.textContent = String(candidates.length)
  for (const candidate of candidates) {
    const row = document.createElement('tr')
    const titleCell = document.createElement('td')
    const title = document.createElement('strong')
    const indexId = document.createElement('small')
    title.textContent = text(candidate.titleHint)
    indexId.textContent = `Hpoi indexed ID: ${text(candidate.indexedProductId)}`
    titleCell.append(title, indexId)

    const hints = document.createElement('td')
    hints.textContent = [candidate.manufacturerHint, candidate.categoryHint, candidate.scaleHint].filter(Boolean).join(' · ') || '待判断'
    const status = document.createElement('td')
    status.textContent = text(candidate.status)
    status.dataset.status = candidate.status || ''
    const matched = document.createElement('td')
    matched.textContent = text(candidate.matchedProductId)
    const resolution = document.createElement('td')
    const evidence = (candidate.resolutionEvidence || []).at(-1)
    resolution.textContent = evidence?.sourceDomain ? `${evidence.sourceDomain} · score ${Number(evidence.score || 0).toFixed(2)}` : '待找正式来源'
    const reason = document.createElement('td')
    reason.textContent = text(candidate.statusReason || candidate.resolutionFailure?.code)
    row.append(titleCell, hints, status, matched, resolution, reason)
    rowsRoot.append(row)
  }
  if (!candidates.length) {
    const row = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = 6
    cell.className = 'muted'
    cell.textContent = '尚无候选。启动一次自动发现后会在这里显示自动处理结果。'
    row.append(cell)
    rowsRoot.append(row)
  }
}

async function load() {
  galleryLink.href = `/gallery/characters/${encodeURIComponent(slug)}`
  const response = await fetch(`/api/discovery/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`status ${response.status}`)
  const data = await response.json()
  characterName.textContent = `${data.character?.displayName || slug} · 收录覆盖`
  renderMetrics(data.coverage)
  renderCandidates(data.candidates || [])
}

load().catch((error) => {
  ratesRoot.textContent = `无法读取本地覆盖数据：${error.message}`
  renderCandidates([])
})
