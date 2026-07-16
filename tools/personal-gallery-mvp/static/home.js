const form = document.querySelector('#collect-form')
const startButton = document.querySelector('#start-button')
const stopButton = document.querySelector('#stop-button')
const statusPill = document.querySelector('#status-pill')
const statusMessage = document.querySelector('#status-message')
const activeGalleryLink = document.querySelector('#active-gallery-link')
const recentRuns = document.querySelector('#recent-runs')
const disambiguation = document.querySelector('#disambiguation')
const counters = {
  pages: document.querySelector('#pages-count'),
  products: document.querySelector('#products-count'),
  images: document.querySelector('#images-count'),
  failures: document.querySelector('#failures-count'),
}

function galleryUrl(run) {
  return run?.runId ? `/gallery/${encodeURIComponent(run.runId)}` : null
}

function renderStatus(run) {
  const status = run?.status || 'idle'
  statusPill.textContent = status
  statusMessage.textContent = run?.stopReason || (run ? `角色：${run.query}` : '暂无运行。')
  for (const [name, element] of Object.entries(counters)) {
    element.textContent = String(run?.progress?.[name] || 0)
  }
  const link = run?.galleryUrl || galleryUrl(run)
  activeGalleryLink.classList.toggle('hidden', !link)
  if (link) activeGalleryLink.href = link
  const running = status === 'running' || status === 'stopping'
  startButton.disabled = running
  stopButton.disabled = !running
  renderDisambiguation(run?.disambiguationCandidates || [])
}

function renderDisambiguation(candidates) {
  disambiguation.replaceChildren()
  disambiguation.classList.toggle('hidden', candidates.length === 0)
  if (!candidates.length) return
  const heading = document.createElement('strong')
  heading.textContent = '请选择明确角色（不会自动猜测同名角色）'
  disambiguation.append(heading)
  for (const candidate of candidates) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'candidate-button'
    const name = document.createElement('span')
    name.textContent = candidate.title || '未命名角色'
    const detail = document.createElement('small')
    detail.textContent = `${candidate.work || '作品未知'} · ${candidate.url}`
    button.append(name, detail)
    button.addEventListener('click', () => {
      document.querySelector('#character-url').value = candidate.url
      form.requestSubmit()
    })
    disambiguation.append(button)
  }
}

function renderRecent(items) {
  recentRuns.replaceChildren()
  if (!items.length) {
    const empty = document.createElement('p')
    empty.className = 'muted'
    empty.textContent = '尚无本地记录。'
    recentRuns.append(empty)
    return
  }
  for (const run of items) {
    const row = document.createElement('div')
    row.className = 'recent-run'
    const label = document.createElement('span')
    label.textContent = `${run.query} · ${run.status}`
    const link = document.createElement('a')
    link.href = galleryUrl(run)
    link.textContent = '打开图库'
    row.append(label, link)
    recentRuns.append(row)
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/status', { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`status ${response.status}`)
    const result = await response.json()
    renderStatus(result.active)
    renderRecent(result.recentRuns || [])
  } catch (error) {
    statusMessage.textContent = `无法读取本地状态：${error.message}`
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const data = new FormData(form)
  const payload = {
    query: data.get('query'),
    characterUrl: data.get('characterUrl'),
    maxListPages: Number(data.get('maxListPages')),
    maxProducts: Number(data.get('maxProducts')),
    maxImagesPerProduct: Number(data.get('maxImagesPerProduct')),
    confirmSourcePermission: data.get('confirmSourcePermission') === 'on',
  }
  startButton.disabled = true
  try {
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const result = await response.json()
    renderStatus(result.job)
    if (!response.ok) {
      const missing = Array.isArray(result.missing) ? ` 缺少：${result.missing.join('、')}` : ''
      statusMessage.textContent = `${result.notice || result.error || '无法启动。'}${missing}`
    }
  } catch (error) {
    statusMessage.textContent = `无法启动本地任务：${error.message}`
  } finally {
    await refresh()
  }
})

stopButton.addEventListener('click', async () => {
  stopButton.disabled = true
  await fetch('/api/runs/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  await refresh()
})

await refresh()
setInterval(refresh, 1_000)
