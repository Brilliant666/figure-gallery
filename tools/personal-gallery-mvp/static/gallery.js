const title = document.querySelector('#gallery-title')
const meta = document.querySelector('#gallery-meta')
const grid = document.querySelector('#product-grid')
const empty = document.querySelector('#empty-state')
const errorMessage = document.querySelector('#gallery-error')
const classificationFilter = document.querySelector('#classification-filter')
const manufacturerFilter = document.querySelector('#manufacturer-filter')
const detailFilter = document.querySelector('#detail-filter')
const showExcluded = document.querySelector('#show-excluded')
const metricList = document.querySelector('#gallery-metrics')
const failureCount = document.querySelector('#failure-count')
const failureList = document.querySelector('#failure-list')

const lightbox = document.querySelector('#lightbox')
const lightboxStage = document.querySelector('#lightbox-stage')
const lightboxImage = document.querySelector('#lightbox-image')
const lightboxPosition = document.querySelector('#lightbox-position')
const lightboxTitle = document.querySelector('#lightbox-product-title')
const lightboxMeta = document.querySelector('#lightbox-product-meta')
const previousButton = document.querySelector('#lightbox-previous')
const nextButton = document.querySelector('#lightbox-next')
const zoomValue = document.querySelector('#zoom-value')

let gallery = null
let visibleImages = []
let currentImageIndex = -1
let zoom = 1
let pollTimer = null
const POLL_INTERVAL_MS = 800

function apiUrlFromPath() {
  const path = window.location.pathname
  const characterPrefix = '/gallery/characters/'
  if (path.startsWith(characterPrefix)) {
    return `/api/gallery/character/${encodeURIComponent(decodeURIComponent(path.slice(characterPrefix.length)))}`
  }
  const runId = decodeURIComponent(path.replace(/^\/gallery\/?/, ''))
  return `/api/gallery/run/${encodeURIComponent(runId)}`
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function isSafeSourceUrl(value) {
  try {
    const url = new URL(value)
    const sensitiveQuery = [...url.searchParams.keys()].some((key) =>
      /^(?:access_?token|api_?key|apikey|auth|authorization|cookie|session|session_?id|sid|token)$/i.test(key),
    )
    return url.protocol === 'https:'
      && ['hpoi.net', 'www.hpoi.net'].includes(url.hostname)
      && !url.username
      && !url.password
      && !sensitiveQuery
  } catch {
    return false
  }
}

function currentProducts() {
  if (!gallery) return []
  const classification = classificationFilter.value
  const manufacturer = manufacturerFilter.value
  const term = detailFilter.value.trim().toLocaleLowerCase('zh-CN')
  return gallery.products.filter((product) => {
    if (!showExcluded.checked && product.excluded) return false
    if (classification === 'default' && product.classification === 'other') return false
    if (classification !== 'default' && classification !== 'all' && product.classification !== classification) return false
    if (manufacturer !== 'all' && product.manufacturer !== manufacturer) return false
    if (term && !`${product.category} ${product.scale}`.toLocaleLowerCase('zh-CN').includes(term)) return false
    return true
  })
}

function orderedProductImages(product) {
  return [...product.images].sort(
    (left, right) =>
      Number(right.sha256 === product.preferredCoverImage) -
      Number(left.sha256 === product.preferredCoverImage),
  )
}

function setPreference(kind, value, enabled) {
  const list = new Set(gallery.preferences[kind] || [])
  if (enabled) list.add(value)
  else list.delete(value)
  gallery.preferences[kind] = [...list]
}

async function persistPreferences() {
  const response = await fetch('/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gallery.preferences),
  })
  if (!response.ok) throw new Error(`preferences ${response.status}`)
  const result = await response.json()
  gallery.preferences = result.preferences
}

async function toggleProduct(product) {
  const next = !product.excluded
  setPreference('excludedProductIds', product.id, next)
  product.excluded = next
  try {
    await persistPreferences()
    render()
  } catch (error) {
    product.excluded = !next
    setPreference('excludedProductIds', product.id, !next)
    showError(`偏好保存失败：${error.message}`)
  }
}

async function toggleImage(image) {
  const next = !image.excluded
  setPreference('excludedImageSha256', image.sha256, next)
  for (const product of gallery.products) {
    for (const candidate of product.images) if (candidate.sha256 === image.sha256) candidate.excluded = next
  }
  try {
    await persistPreferences()
    render()
  } catch (error) {
    setPreference('excludedImageSha256', image.sha256, !next)
    for (const product of gallery.products) {
      for (const candidate of product.images) if (candidate.sha256 === image.sha256) candidate.excluded = !next
    }
    showError(`偏好保存失败：${error.message}`)
  }
}

async function setPreferredCover(product, image) {
  const previous = product.preferredCoverImage
  gallery.preferences.preferredCoverImage[product.id] = image.sha256
  product.preferredCoverImage = image.sha256
  try {
    await persistPreferences()
    render()
  } catch (error) {
    if (previous) gallery.preferences.preferredCoverImage[product.id] = previous
    else delete gallery.preferences.preferredCoverImage[product.id]
    product.preferredCoverImage = previous
    showError(`封面偏好保存失败：${error.message}`)
  }
}

async function editManualNote(product) {
  const next = window.prompt('个人拍摄参考备注（留空即清除）', product.note || '')
  if (next === null) return
  const previous = product.note
  product.note = next.trim()
  if (product.note) gallery.preferences.manualNote[product.id] = product.note
  else delete gallery.preferences.manualNote[product.id]
  try {
    await persistPreferences()
    render()
  } catch (error) {
    product.note = previous
    if (previous) gallery.preferences.manualNote[product.id] = previous
    else delete gallery.preferences.manualNote[product.id]
    showError(`备注保存失败：${error.message}`)
  }
}

function showError(message) {
  errorMessage.textContent = message
  errorMessage.classList.remove('hidden')
}

function clearError() {
  errorMessage.textContent = ''
  errorMessage.classList.add('hidden')
}

function stopPolling() {
  if (pollTimer !== null) clearTimeout(pollTimer)
  pollTimer = null
}

function schedulePolling() {
  if (pollTimer !== null) return
  pollTimer = setTimeout(async () => {
    pollTimer = null
    await load()
  }, POLL_INTERVAL_MS)
}

function createImageTile(product, image) {
  const tile = element('div', `image-tile${image.excluded ? ' is-excluded' : ''}`)
  const open = element('button', 'image-open')
  open.type = 'button'
  open.setAttribute('aria-label', `放大 ${product.title}`)
  const img = document.createElement('img')
  img.src = image.mediaUrl
  img.alt = image.alt
  img.loading = 'lazy'
  img.decoding = 'async'
  img.width = image.width || 800
  img.height = image.height || 800
  img.dataset.sha256 = image.sha256
  open.append(img)
  open.addEventListener('click', () => openLightbox(image.sha256, product.id))
  const actions = element('div', 'image-actions')
  const cover = element(
    'button',
    'image-action cover-action',
    product.preferredCoverImage === image.sha256 ? '当前封面' : '设为封面',
  )
  cover.type = 'button'
  cover.disabled = product.preferredCoverImage === image.sha256
  cover.addEventListener('click', () => setPreferredCover(product, image))
  const exclude = element('button', 'image-action', image.excluded ? '恢复图片' : '排除图片')
  exclude.type = 'button'
  exclude.addEventListener('click', () => toggleImage(image))
  actions.append(cover, exclude)
  tile.append(open, actions)
  return tile
}

function createProductCard(product) {
  const card = element('article', `product-card${product.excluded ? ' is-excluded' : ''}`)
  card.dataset.productId = product.id
  const header = element('header', 'product-card-header')
  header.append(element('h2', null, product.title))
  header.append(
    element('p', 'product-meta', `${product.manufacturer} · ${product.classification} · ${product.scale}`),
  )
  header.append(element('p', 'product-meta', `${product.category} · ${product.status}`))
  if (product.note) header.append(element('p', 'product-note', product.note))
  card.append(header)

  const images = orderedProductImages(product).filter((image) => showExcluded.checked || !image.excluded)
  for (const image of images) card.append(createImageTile(product, image))

  const actions = element('footer', 'card-actions')
  const exclude = element('button', null, product.excluded ? '恢复商品' : '排除商品')
  exclude.type = 'button'
  exclude.addEventListener('click', () => toggleProduct(product))
  actions.append(exclude)
  const note = element('button', null, product.note ? '编辑备注' : '添加备注')
  note.type = 'button'
  note.addEventListener('click', () => editManualNote(product))
  actions.append(note)
  if (isSafeSourceUrl(product.sourceUrl)) {
    const source = element('a', 'source-link', '来源页 ↗')
    source.href = product.sourceUrl
    source.target = '_blank'
    source.rel = 'noreferrer noopener'
    actions.append(source)
  }
  card.append(actions)
  return card
}

function renderMetrics(products) {
  const imageCount = products.reduce(
    (sum, product) => sum + product.images.filter((image) => showExcluded.checked || !image.excluded).length,
    0,
  )
  const entries = [
    ['发现商品', gallery.summary.products],
    ['当前商品', products.length],
    ['当前图片', imageCount],
    ['失败', gallery.failures.length],
  ]
  metricList.replaceChildren(
    ...entries.map(([label, value]) => {
      const wrapper = document.createElement('div')
      wrapper.append(element('dt', null, label), element('dd', null, String(value)))
      return wrapper
    }),
  )
}

function renderFailures() {
  failureCount.textContent = String(gallery.failures.length)
  failureList.replaceChildren()
  for (const failure of gallery.failures) {
    const text =
      typeof failure === 'string'
        ? failure
        : `${failure.type || failure.stage || 'failure'}：${failure.reason || failure.message || failure.url || 'unknown'}`
    failureList.append(element('li', null, text))
  }
}

function render() {
  const products = currentProducts()
  grid.replaceChildren(...products.map(createProductCard))
  visibleImages = products.flatMap((product) =>
    orderedProductImages(product)
      .filter((image) => showExcluded.checked || !image.excluded)
      .map((image) => ({ image, product })),
  )
  empty.classList.toggle('hidden', visibleImages.length > 0)
  renderMetrics(products)
  renderFailures()
}

function updateLightbox() {
  const item = visibleImages[currentImageIndex]
  if (!item) return closeLightbox()
  lightboxImage.src = item.image.mediaUrl
  lightboxImage.alt = item.image.alt
  lightboxPosition.textContent = `${currentImageIndex + 1} / ${visibleImages.length}`
  lightboxTitle.textContent = item.product.title
  lightboxMeta.textContent = `${item.product.manufacturer} · ${item.product.classification} · ${item.product.scale}`
  previousButton.disabled = currentImageIndex === 0
  nextButton.disabled = currentImageIndex === visibleImages.length - 1
}

function setZoom(value, actual = false) {
  zoom = Math.min(4, Math.max(.25, value))
  lightboxStage.classList.toggle('actual', actual)
  lightboxImage.style.transform = `scale(${zoom})`
  zoomValue.value = `${Math.round(zoom * 100)}%`
  zoomValue.textContent = `${Math.round(zoom * 100)}%`
}

function openLightbox(sha256, productId) {
  currentImageIndex = visibleImages.findIndex(
    (item) => item.image.sha256 === sha256 && item.product.id === productId,
  )
  if (currentImageIndex < 0) return
  setZoom(1)
  lightbox.classList.remove('hidden')
  document.body.classList.add('lightbox-open')
  updateLightbox()
  document.querySelector('#lightbox-close').focus()
}

function closeLightbox() {
  lightbox.classList.add('hidden')
  document.body.classList.remove('lightbox-open')
  lightboxImage.removeAttribute('src')
  currentImageIndex = -1
}

function moveLightbox(delta) {
  const next = currentImageIndex + delta
  if (next < 0 || next >= visibleImages.length) return
  currentImageIndex = next
  setZoom(1)
  updateLightbox()
}

async function load() {
  try {
    const response = await fetch(apiUrlFromPath(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (response.status === 404) {
      document.body.dataset.galleryStatus = 'waiting'
      title.textContent = '正在建立本地图库…'
      meta.textContent = '运行记录尚未写入；页面会在本机轮询已有 manifest。'
      clearError()
      schedulePolling()
      return
    }
    if (!response.ok) throw new Error(`gallery ${response.status}`)
    gallery = await response.json()
    document.body.dataset.galleryStatus = gallery.status
    clearError()
    title.textContent = gallery.query
    document.title = `${gallery.query} · Private Gallery`
    meta.textContent = `最近收集：${gallery.completedAt || gallery.startedAt || 'unknown'} · 状态：${gallery.status}`
    const selectedManufacturer = manufacturerFilter.value
    manufacturerFilter.replaceChildren()
    const allManufacturers = document.createElement('option')
    allManufacturers.value = 'all'
    allManufacturers.textContent = '全部厂商'
    manufacturerFilter.append(allManufacturers)
    const manufacturers = [...new Set(gallery.products.map((product) => product.manufacturer))].sort()
    for (const manufacturer of manufacturers) {
      const option = document.createElement('option')
      option.value = manufacturer
      option.textContent = manufacturer
      manufacturerFilter.append(option)
    }
    if (manufacturers.includes(selectedManufacturer)) manufacturerFilter.value = selectedManufacturer
    render()
    if (gallery.status === 'running' || gallery.status === 'stopping') schedulePolling()
    else stopPolling()
  } catch (error) {
    stopPolling()
    showError(`无法读取本地图库：${error.message}`)
    title.textContent = '图库不可用'
  }
}

for (const control of [classificationFilter, manufacturerFilter, detailFilter, showExcluded]) {
  control.addEventListener(control === detailFilter ? 'input' : 'change', render)
}
document.querySelector('#lightbox-close').addEventListener('click', closeLightbox)
previousButton.addEventListener('click', () => moveLightbox(-1))
nextButton.addEventListener('click', () => moveLightbox(1))
document.querySelector('#zoom-in').addEventListener('click', () => setZoom(zoom + .25))
document.querySelector('#zoom-out').addEventListener('click', () => setZoom(zoom - .25))
document.querySelector('#zoom-fit').addEventListener('click', () => setZoom(1))
document.querySelector('#zoom-actual').addEventListener('click', () => setZoom(1, true))
lightboxStage.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    setZoom(zoom + (event.deltaY < 0 ? .25 : -.25))
  },
  { passive: false },
)
document.addEventListener('keydown', (event) => {
  if (lightbox.classList.contains('hidden')) return
  if (event.key === 'Escape') closeLightbox()
  if (event.key === 'ArrowLeft') moveLightbox(-1)
  if (event.key === 'ArrowRight') moveLightbox(1)
})
window.addEventListener('beforeunload', stopPolling)

await load()
