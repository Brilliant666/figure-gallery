const form = document.querySelector('#collect-form')
const confirmationForm = document.querySelector('#character-confirmation')
const startButton = document.querySelector('#start-button')
const stopButton = document.querySelector('#stop-button')
const statusPill = document.querySelector('#status-pill')
const statusMessage = document.querySelector('#status-message')
const activeGalleryLink = document.querySelector('#active-gallery-link')
const recentRuns = document.querySelector('#recent-runs')
const characterGalleries = document.querySelector('#character-galleries')
const queryInput = document.querySelector('#query')
const counters = {
  pages: document.querySelector('#pages-count'),
  products: document.querySelector('#products-count'),
  images: document.querySelector('#images-count'),
  failures: document.querySelector('#failures-count'),
}

function galleryUrl(run) {
  if (run?.characterSlug) return `/gallery/characters/${encodeURIComponent(run.characterSlug)}`
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
}

function emptyMessage(container, text) {
  const empty = document.createElement('p')
  empty.className = 'muted'
  empty.textContent = text
  container.append(empty)
}

function renderRecent(items) {
  recentRuns.replaceChildren()
  if (!items.length) return emptyMessage(recentRuns, '尚无本地记录。')
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

function renderCharacters(items) {
  characterGalleries.replaceChildren()
  const galleries = items.filter((character) => character.hasGallery)
  if (!galleries.length) return emptyMessage(characterGalleries, '尚无本地图库。')
  for (const character of galleries) {
    const row = document.createElement('div')
    row.className = 'recent-run'
    const label = document.createElement('span')
    label.textContent = `${character.displayName} · ${character.summary?.products || 0} 款`
    const link = document.createElement('a')
    link.href = `/gallery/characters/${encodeURIComponent(character.slug)}`
    link.textContent = '打开图库'
    row.append(label, link)
    characterGalleries.append(row)
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/status', { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`status ${response.status}`)
    const result = await response.json()
    if (!queryInput.value && result.defaultQuery) queryInput.value = result.defaultQuery
    renderStatus(result.active)
    renderRecent(result.recentRuns || [])
    renderCharacters(result.characters || [])
  } catch (error) {
    statusMessage.textContent = `无法读取本地状态：${error.message}`
  }
}

function collectionPayload() {
  const data = new FormData(form)
  return {
    query: data.get('query'),
    sourceMode: 'official_sources',
    maxSearchResults: Number(data.get('maxSearchResults')),
    maxCandidates: Number(data.get('maxCandidates')),
    maxProducts: Number(data.get('maxProducts')),
    maxImagesPerProduct: Number(data.get('maxImagesPerProduct')),
    confirmOfficialSourceAccess: data.get('confirmOfficialSourceAccess') === 'on',
  }
}

async function startCollection(payload) {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json()
  renderStatus(result.job)
  if (response.status === 409 && result.error === 'character_confirmation_required') {
    const suggested = result.suggestedCharacter || {}
    confirmationForm.elements.displayName.value = suggested.displayName || payload.query
    confirmationForm.elements.slug.value = suggested.slug || ''
    confirmationForm.elements.aliases.value = (suggested.aliases || [payload.query]).join('\n')
    confirmationForm.elements.workNames.value = (suggested.workNames || []).join('\n')
    confirmationForm.classList.remove('hidden')
    statusMessage.textContent = '请先确认新角色的别名和作品。'
    return
  }
  if (!response.ok) {
    const missing = Array.isArray(result.missing) ? ` 缺少：${result.missing.join('、')}` : ''
    statusMessage.textContent = `${result.notice || result.error || '无法启动。'}${missing}`
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  startButton.disabled = true
  try {
    await startCollection(collectionPayload())
  } catch (error) {
    statusMessage.textContent = `无法启动本地任务：${error.message}`
  } finally {
    await refresh()
  }
})

confirmationForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const data = new FormData(confirmationForm)
  const lines = (name) => String(data.get(name) || '').split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const slug = String(data.get('slug') || '').trim()
  const response = await fetch('/api/characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      characterId: `local:${slug}`,
      slug,
      displayName: data.get('displayName'),
      aliases: lines('aliases'),
      workNames: lines('workNames'),
    }),
  })
  const result = await response.json()
  if (!response.ok) {
    statusMessage.textContent = result.error || '角色配置保存失败。'
    return
  }
  confirmationForm.classList.add('hidden')
  queryInput.value = result.character.displayName
  await startCollection(collectionPayload())
  await refresh()
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
