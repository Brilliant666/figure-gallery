import {
  filterGalleryProducts,
  GALLERY_SOURCE_DISPLAY_LABELS,
  galleryManufacturerOptions,
  galleryReferenceProducts,
  galleryTypeOptions,
} from '/assets/gallery-read-model.js'

const title = document.querySelector('#gallery-title')
const meta = document.querySelector('#gallery-meta')
const grid = document.querySelector('#product-grid')
const empty = document.querySelector('#empty-state')
const errorMessage = document.querySelector('#gallery-error')
const referenceIndex = document.querySelector('#reference-index')
const productDetail = document.querySelector('#product-detail')
const gallerySearch = document.querySelector('#gallery-search')
const classificationFilter = document.querySelector('#classification-filter')
const manufacturerFilter = document.querySelector('#manufacturer-filter')
const sortMode = document.querySelector('#sort-mode')
const sortModeField = document.querySelector('#sort-mode-field')
const designFilter = document.querySelector('#design-filter')
const scaleFilter = document.querySelector('#scale-filter')
const designFilterField = document.querySelector('#design-filter-field')
const scaleFilterField = document.querySelector('#scale-filter-field')
const showExcluded = document.querySelector('#show-excluded')
const detailShowExcluded = document.querySelector('#detail-show-excluded')
const metricList = document.querySelector('#gallery-metrics')
const failureCount = document.querySelector('#failure-count')
const failureList = document.querySelector('#failure-list')
const sourceMode = document.querySelector('#source-mode')
const hpoiSourceStatus = document.querySelector('#hpoi-source-status')

const detailTitle = document.querySelector('#product-title')
const detailMeta = document.querySelector('#product-meta')
const detailSourceMeta = document.querySelector('#product-source-meta')
const detailImageCount = document.querySelector('#detail-image-count')
const detailFailureCount = document.querySelector('#detail-failure-count')
const detailFailureSummaryCount = document.querySelector('#detail-failure-summary-count')
const detailFailureList = document.querySelector('#detail-failure-list')
const detailFailures = document.querySelector('#detail-failures')
const detailGrid = document.querySelector('#detail-image-grid')
const detailNoImages = document.querySelector('#detail-no-images')
const detailActions = document.querySelector('#detail-actions')
const currentCover = document.querySelector('#current-cover')
const coverSelection = document.querySelector('#cover-selection')
const productNote = document.querySelector('#product-note')
const detailBackLink = document.querySelector('#detail-back-link')
const prototypeCatalogSection = document.querySelector('#prototype-catalog-section')
const catalogItemCount = document.querySelector('#catalog-item-count')
const catalogItemList = document.querySelector('#catalog-item-list')

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
const OFFICIAL_SOURCE_DOMAINS = new Set([
  'goodsmile.com',
  'www.goodsmile.com',
  'goodsmile.info',
  'www.goodsmile.info',
  'goodsmilearts.com',
  'www.goodsmilearts.com',
  'alter-web.jp',
  'www.alter-web.jp',
  'amiami.jp',
  'www.amiami.jp',
  'apex-toys.com',
  'www.apex-toys.com',
])
const CATALOG_SOURCE_DOMAINS = new Set([
  ...OFFICIAL_SOURCE_DOMAINS,
  'solarisjapan.com',
  'www.solarisjapan.com',
  'japan-figure.com',
  'www.japan-figure.com',
])
const SOURCE_FAMILY_LABELS = GALLERY_SOURCE_DISPLAY_LABELS
const CLASSIFICATION_LABELS = Object.freeze({
  likely_scale: '比例手办',
  likely_prize: '景品',
  likely_static: '静态完成品',
})

function classificationLabel(value) {
  return CLASSIFICATION_LABELS[value] || '待确认'
}

function parseRoute(pathname = window.location.pathname) {
  const characterMatch = /^\/gallery\/characters\/([^/]+)(?:\/(products|prototypes)\/([^/]+))?\/?$/u.exec(pathname)
  if (characterMatch) {
    return {
      mode: characterMatch[3] ? 'detail' : 'character',
      characterSlug: decodeURIComponent(characterMatch[1]),
      detailKind: characterMatch[2] || null,
      productId: characterMatch[3] ? decodeURIComponent(characterMatch[3]) : null,
    }
  }
  return {
    mode: 'run',
    runId: decodeURIComponent(pathname.replace(/^\/gallery\/?/u, '')),
    characterSlug: null,
    productId: null,
  }
}

const route = parseRoute()

function apiUrlFromRoute() {
  if (route.mode === 'run') return `/api/gallery/run/${encodeURIComponent(route.runId)}`
  return `/api/gallery/character/${encodeURIComponent(route.characterSlug)}`
}

function characterGalleryPath() {
  const slug = gallery?.characterSlug || route.characterSlug
  return slug ? `/gallery/characters/${encodeURIComponent(slug)}` : `/gallery/${encodeURIComponent(route.runId)}`
}

function productDetailPath(productId) {
  const segment = gallery?.viewMode === 'prototype_projection' ? 'prototypes' : 'products'
  return `${characterGalleryPath()}/${segment}/${encodeURIComponent(productId)}`
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function isSafeSourceUrl(value, expectedDomain) {
  try {
    const url = new URL(value)
    const actualDomain = CATALOG_SOURCE_DOMAINS.has(url.hostname)
      ? url.hostname.replace(/^www\./u, '')
      : null
    const expectedHost = String(expectedDomain || '').trim().toLowerCase()
    const normalizedExpectedDomain = CATALOG_SOURCE_DOMAINS.has(expectedHost)
      ? expectedHost.replace(/^www\./u, '')
      : null
    const sensitiveQuery = [...url.searchParams.keys()].some((key) =>
      /^(?:access_?token|api_?key|apikey|auth|authorization|cookie|session|session_?id|sid|token)$/iu.test(key),
    )
    return url.protocol === 'https:'
      && actualDomain !== null
      && (!expectedHost || (normalizedExpectedDomain !== null && actualDomain === normalizedExpectedDomain))
      && !url.username
      && !url.password
      && !sensitiveQuery
  } catch {
    return false
  }
}

function currentProducts() {
  if (!gallery) return []
  return filterGalleryProducts(gallery.products, {
    search: gallerySearch.value,
    classification: classificationFilter.value,
    manufacturer: manufacturerFilter.value,
    design: designFilter.value,
    scale: scaleFilter.value,
    showExcluded: showExcluded.checked,
    includeLegacyFilters: gallery.viewMode !== 'prototype_projection',
  })
}

function referenceProducts() {
  return galleryReferenceProducts(gallery?.products || [])
}

function selectedProduct() {
  const id = resolvePrototypeAlias(route.productId)
  return gallery?.products.find((product) => product.id === id) || null
}

function resolvePrototypeAlias(value) {
  let current = value
  const aliases = gallery?.prototypeAliases || {}
  const seen = new Set()
  while (current && Object.hasOwn(aliases, current)) {
    if (seen.has(current)) return value
    seen.add(current)
    current = aliases[current]
  }
  return current
}

function canonicalizePrototypeRoute() {
  if (route.mode !== 'detail' || gallery?.viewMode !== 'prototype_projection') return
  const resolved = resolvePrototypeAlias(route.productId)
  if (!resolved || resolved === route.productId) return
  route.productId = resolved
  window.history.replaceState(null, '', productDetailPath(resolved))
}

function setPreference(kind, value, enabled) {
  const list = new Set(gallery.preferences[kind] || [])
  if (enabled) list.add(value)
  else list.delete(value)
  gallery.preferences[kind] = [...list]
}

function productPreference(productId) {
  gallery.preferences.products ||= {}
  gallery.preferences.products[productId] ||= {}
  return gallery.preferences.products[productId]
}

async function persistPreferences() {
  const response = await fetch(`/api/preferences/${encodeURIComponent(gallery.characterSlug)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gallery.preferences),
  })
  if (!response.ok) throw new Error(`preferences ${response.status}`)
  const result = await response.json()
  gallery.preferences = result.preferences
}

async function persistAndReload() {
  await persistPreferences()
  await load()
}

async function toggleProduct(product) {
  const next = !product.excluded
  setPreference('excludedProductIds', product.id, next)
  try {
    await persistAndReload()
  } catch (error) {
    setPreference('excludedProductIds', product.id, !next)
    showError(`偏好保存失败：${error.message}`)
  }
}

async function toggleImage(image) {
  const next = !image.excluded
  setPreference('excludedImageSha256', image.sha256, next)
  try {
    await persistAndReload()
  } catch (error) {
    setPreference('excludedImageSha256', image.sha256, !next)
    showError(`偏好保存失败：${error.message}`)
  }
}

async function setPreferredCover(product, image) {
  const previous = product.preferredCoverImageUrl || product.preferredCoverImageId
  const next = image.remote ? image.url : image.sha256
  if (image.remote) {
    productPreference(product.id).preferredCoverImageUrl = next
    delete productPreference(product.id).preferredCoverImageId
  } else {
    productPreference(product.id).preferredCoverImageId = next
    delete productPreference(product.id).preferredCoverImageUrl
  }
  gallery.preferences.preferredCoverImage ||= {}
  gallery.preferences.preferredCoverImage[product.id] = next
  try {
    await persistAndReload()
  } catch (error) {
    if (previous) {
      if (previous.startsWith('https:' + '//')) productPreference(product.id).preferredCoverImageUrl = previous
      else productPreference(product.id).preferredCoverImageId = previous
      gallery.preferences.preferredCoverImage[product.id] = previous
    } else {
      delete productPreference(product.id).preferredCoverImageId
      delete productPreference(product.id).preferredCoverImageUrl
      delete gallery.preferences.preferredCoverImage[product.id]
    }
    showError(`封面偏好保存失败：${error.message}`)
  }
}

async function editManualNote(product) {
  const next = window.prompt('个人拍摄参考备注（留空即清除）', product.note || '')
  if (next === null) return
  const note = next.trim()
  if (note) {
    productPreference(product.id).manualNote = note
    gallery.preferences.manualNote ||= {}
    gallery.preferences.manualNote[product.id] = note
  } else {
    delete productPreference(product.id).manualNote
    delete gallery.preferences.manualNote[product.id]
  }
  try {
    await persistAndReload()
  } catch (error) {
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

function createCover(product) {
  const frame = element('div', 'reference-cover-frame')
  if (!product.coverImage) {
    frame.append(
      element('div', 'no-image-placeholder', '暂无可用图片'),
    )
    frame.dataset.coverState = 'missing'
    return frame
  }
  const image = document.createElement('img')
  image.className = 'reference-cover'
  image.src = product.coverImage.mediaUrl
  image.alt = `${product.title} 拍摄参考封面`
  image.loading = 'lazy'
  image.decoding = 'async'
  image.width = product.coverImage.width || 800
  image.height = product.coverImage.height || 1000
  image.dataset.sha256 = product.coverImage.sha256
  image.dataset.imageId = product.coverImage.id || product.coverImage.sha256
  image.dataset.coverSource = product.coverSelectionSource
  frame.append(image)
  frame.dataset.coverState = 'available'
  return frame
}

function createProductCard(product) {
  const card = element('article', `product-card reference-card${product.excluded ? ' is-excluded' : ''}`)
  card.dataset.productId = product.id
  const link = element('a', 'reference-card-link')
  link.href = productDetailPath(product.id)
  link.setAttribute('aria-label', `查看 ${product.title} 全部参考图片`)
  link.append(createCover(product))
  const body = element('div', 'reference-card-body')
  body.append(element('h2', null, product.title))
  body.append(element('p', 'product-meta', product.manufacturer))
  body.append(element(
    'p',
    'product-meta',
    [product.scale !== 'unknown' ? product.scale : '', classificationLabel(product.classification)]
      .filter(Boolean)
      .join(' · '),
  ))
  link.append(body)
  card.append(link)
  return card
}

function createDetailImageTile(product, image) {
  const tile = element('article', `image-tile detail-image-tile${image.excluded ? ' is-excluded' : ''}`)
  tile.dataset.sha256 = image.sha256
  const open = element('button', 'image-open')
  open.type = 'button'
  open.setAttribute('aria-label', `放大 ${product.title} 参考图片`)
  const img = document.createElement('img')
  img.src = image.mediaUrl
  img.alt = image.alt
  img.loading = 'lazy'
  img.decoding = 'async'
  img.width = image.width || 800
  img.height = image.height || 800
  img.dataset.sha256 = image.sha256
  img.dataset.imageId = image.id || image.sha256
  open.append(img)
  open.addEventListener('click', () => openLightbox(image.id || image.sha256, product.id))
  const actions = element('div', 'image-actions')
  const isPreferred = Boolean(
    product.preferredCoverImageUrl && product.preferredCoverImageUrl === image.url ||
    product.preferredCoverImageId && product.preferredCoverImageId === image.sha256,
  )
  const cover = element('button', 'image-action cover-action', isPreferred ? '当前人工封面' : '设为封面')
  cover.type = 'button'
  cover.disabled = isPreferred
  cover.addEventListener('click', () => setPreferredCover(product, image))
  const exclude = element('button', 'image-action exclude-image-action', image.excluded ? '恢复图片' : '排除图片')
  exclude.type = 'button'
  exclude.addEventListener('click', () => toggleImage(image))
  actions.append(cover, exclude)
  const provenance = image.sourceFamily
    ? element('span', 'image-provenance', SOURCE_FAMILY_LABELS[image.sourceFamily] || SOURCE_FAMILY_LABELS.unknown)
    : null
  tile.append(open, ...(provenance ? [provenance] : []), actions)
  return tile
}

function renderMetrics() {
  const reference = referenceProducts()
  const entries = gallery.viewMode === 'prototype_projection'
    ? [
        ['Catalog Items', gallery.summary.projectionEligibleCount],
        ['独立姿势', reference.length],
        ['图片引用', gallery.summary.imageCount],
        ['有封面姿势', reference.filter((product) => product.coverImage).length],
        ['归组冲突', gallery.summary.groupingConflictCount || 0],
      ]
    : [
        ['商品', reference.length],
        ['本地图片', reference.reduce((total, product) => total + product.images.length, 0)],
        ['索引封面', reference.filter((product) => product.coverImage).length],
        ['无图商品', reference.filter((product) => !product.coverImage).length],
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

function failureLabel(failure) {
  if (typeof failure === 'string') return failure
  const kind = failure.kind || failure.type || failure.stage || 'failure'
  const code = failure.code || failure.reason || 'unknown'
  const status = failure.status || failure.statusCode
  return `${kind}：${code}${status ? ` · HTTP ${status}` : ''}`
}

function renderFailures() {
  failureCount.textContent = String(gallery.failures.length)
  failureList.replaceChildren(...gallery.failures.map((failure) => element('li', null, failureLabel(failure))))
}

function replaceFilterOptions(select, values, allLabel, labelFor = (value) => value) {
  const selected = select.value
  const all = document.createElement('option')
  all.value = 'all'
  all.textContent = allLabel
  select.replaceChildren(all)
  for (const value of [...new Set(values.filter(Boolean))].sort()) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = labelFor(value)
    select.append(option)
  }
  if ([...select.options].some((option) => option.value === selected)) select.value = selected
}

function renderSourceStatus() {
  sourceMode.textContent = gallery.viewMode === 'prototype_projection'
    ? 'Frozen Catalog Item projection'
    : gallery.sourceMode === 'official_sources' ? 'Official sources' : gallery.sourceMode
  const hpoi = gallery.sourceStatus?.hpoi || {}
  const blockedAt = hpoi.blockedAt ? ` · 记录时间：${hpoi.blockedAt}` : ''
  hpoiSourceStatus.textContent = hpoi.hpoiLiveStatus === 'blocked_by_source'
    ? `Hpoi 状态：Blocked by captcha · 实时来源已停用，不会自动重试。${blockedAt}`
    : 'Hpoi 实时来源已停用，不会自动重试。'
}

function renderIndex() {
  referenceIndex.classList.remove('hidden')
  productDetail.classList.add('hidden')
  const products = currentProducts()
  grid.replaceChildren(...products.map(createProductCard))
  empty.classList.toggle('hidden', products.length > 0)
  visibleImages = []
  meta.textContent = gallery.viewMode === 'prototype_projection'
    ? `${gallery.summary.projectionEligibleCount} 个有效 Catalog Items · ${referenceProducts().length} 个独立姿势 · 一姿势一卡`
    : `${referenceProducts().length} 款手办 · 每款仅显示一张拍摄参考封面`
  renderMetrics()
  renderFailures()
}

function coverSourceLabel(product) {
  if (!product.coverImage) return '暂无可用图片'
  if (product.coverSelectionSource === 'manual_override') return '人工选择'
  if (product.coverSelectionSource === 'projection_rule') return '投影确定性规则'
  if (product.coverSelectionSource === 'official_primary') return '官方主图自动选择'
  if (product.coverSelectionSource === 'automatic_recommendation') return '确定性规则自动推荐'
  return '第一张有效图片'
}

function renderSortMode() {
  const isProjection = gallery.viewMode === 'prototype_projection'
  sortModeField.classList.toggle('hidden', !isProjection)
  if (!isProjection) return
  const option = document.createElement('option')
  option.value = gallery.sort?.mode || 'recommended_reference_completeness_v1'
  option.textContent = gallery.sort?.label === '推荐' ? '推荐' : '推荐（参考资料完整度）'
  sortMode.replaceChildren(option)
}

function sourceFamilyLabel(value) {
  return SOURCE_FAMILY_LABELS[value] || SOURCE_FAMILY_LABELS.unknown
}

function renderCatalogItems(product) {
  const items = product.catalogItems || []
  prototypeCatalogSection.classList.toggle('hidden', gallery.viewMode !== 'prototype_projection')
  if (gallery.viewMode !== 'prototype_projection') {
    catalogItemList.replaceChildren()
    return
  }
  catalogItemCount.textContent = String(items.length)
  const cards = items.map((item) => {
    const card = element('article', 'catalog-item-card')
    card.append(element('h4', null, item.title))
    const facts = [item.manufacturer, item.scale, item.release].filter((value) => value && value !== 'unknown')
    if (facts.length) card.append(element('p', 'product-meta', facts.join(' · ')))
    const links = element('div', 'catalog-source-links')
    for (const source of item.sources || []) {
      if (!isSafeSourceUrl(source.url)) continue
      const link = element(
        'a',
        null,
        source.sourceFamily && source.sourceFamily !== 'unknown'
          ? sourceFamilyLabel(source.sourceFamily)
          : source.label || sourceFamilyLabel('unknown'),
      )
      link.href = source.url
      link.target = '_blank'
      link.rel = 'noreferrer noopener'
      links.append(link)
    }
    if (links.childElementCount) card.append(links)
    return card
  })
  catalogItemList.replaceChildren(...cards)
}

function renderDetailActions(product) {
  const exclude = element('button', 'secondary', product.excluded ? '恢复商品' : '排除商品')
  exclude.type = 'button'
  exclude.addEventListener('click', () => toggleProduct(product))
  const note = element('button', 'secondary', product.note ? '编辑备注' : '添加备注')
  note.type = 'button'
  note.addEventListener('click', () => editManualNote(product))
  detailActions.replaceChildren(exclude, note)
  if (gallery.viewMode !== 'prototype_projection' && isSafeSourceUrl(product.sourceUrl, product.sourceDomain)) {
    const source = element('a', 'button-link', '打开官方商品页 ↗')
    source.href = product.sourceUrl
    source.target = '_blank'
    source.rel = 'noreferrer noopener'
    detailActions.append(source)
  }
}

function renderDetailFailures(product) {
  detailFailureCount.textContent = String(product.failureCount)
  detailFailureSummaryCount.textContent = String(product.failureCount)
  detailFailureList.replaceChildren(
    ...product.imageFailures.map((failure) => element('li', null, failureLabel(failure))),
  )
  detailFailures.classList.toggle('hidden', product.failureCount === 0)
}

function renderDetail() {
  const product = selectedProduct()
  if (!product) {
    referenceIndex.classList.add('hidden')
    productDetail.classList.add('hidden')
    showError('找不到这款手办；请返回角色图库。')
    return
  }
  referenceIndex.classList.add('hidden')
  productDetail.classList.remove('hidden')
  detailBackLink.href = characterGalleryPath()
  detailBackLink.textContent = `← 返回${gallery.query}`
  title.textContent = gallery.query
  meta.textContent = gallery.viewMode === 'prototype_projection'
    ? '独立姿势详情 · 全部现有参考图片与关联 Catalog Items'
    : '手办详情 · 全部官方参考图片'
  detailTitle.textContent = product.title
  detailMeta.textContent = [
    product.manufacturer,
    product.scale !== 'unknown' ? product.scale : '',
    classificationLabel(product.classification),
  ].filter(Boolean).join(' · ')
  detailSourceMeta.textContent = gallery.viewMode === 'prototype_projection'
    ? `${product.catalogItems.length} catalog items grouped · ${product.images.length} image refs`
    : `${product.sourceKind} · ${product.sourceDomain}`
  detailImageCount.textContent = String(product.images.length)
  coverSelection.textContent = coverSourceLabel(product)
  currentCover.replaceChildren(product.coverImage ? createCover(product) : element('div', 'no-image-placeholder', '暂无可用图片'))
  productNote.textContent = product.note
  productNote.classList.toggle('hidden', !product.note)
  renderDetailActions(product)
  renderDetailFailures(product)
  renderCatalogItems(product)
  const images = product.images.filter((image) => detailShowExcluded.checked || !image.excluded)
  detailGrid.replaceChildren(...images.map((image) => createDetailImageTile(product, image)))
  detailNoImages.classList.toggle('hidden', images.length > 0)
  visibleImages = images.map((image) => ({ image, product }))
}

function render() {
  if (!gallery) return
  if (route.mode === 'detail') renderDetail()
  else renderIndex()
}

function updateLightbox() {
  const item = visibleImages[currentImageIndex]
  if (!item) return closeLightbox()
  lightboxImage.src = item.image.mediaUrl
  lightboxImage.alt = item.image.alt
  lightboxPosition.textContent = `${currentImageIndex + 1} / ${visibleImages.length}`
  lightboxTitle.textContent = item.product.title
  lightboxMeta.textContent = [
    item.product.manufacturer,
    classificationLabel(item.product.classification),
    item.image.sourceFamily ? sourceFamilyLabel(item.image.sourceFamily) : item.product.scale,
  ].filter(Boolean).join(' · ')
  previousButton.disabled = currentImageIndex === 0
  nextButton.disabled = currentImageIndex === visibleImages.length - 1
}

function setZoom(value, actual = false) {
  zoom = Math.min(4, Math.max(0.25, value))
  lightboxStage.classList.toggle('actual', actual)
  lightboxImage.style.transform = `scale(${zoom})`
  zoomValue.value = `${Math.round(zoom * 100)}%`
  zoomValue.textContent = `${Math.round(zoom * 100)}%`
}

function openLightbox(imageId, productId) {
  currentImageIndex = visibleImages.findIndex(
    (item) => (item.image.id || item.image.sha256) === imageId && item.product.id === productId,
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
    const response = await fetch(apiUrlFromRoute(), {
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
    canonicalizePrototypeRoute()
    document.body.dataset.galleryStatus = gallery.status
    document.body.dataset.view = route.mode
    clearError()
    title.textContent = gallery.query
    document.title = route.mode === 'detail'
      ? `${selectedProduct()?.title || gallery.query} · Shooting Reference`
      : `${gallery.query} · Shooting Reference Index`
    renderSourceStatus()
    renderSortMode()
    replaceFilterOptions(
      classificationFilter,
      galleryTypeOptions(gallery.products),
      '全部类型',
      classificationLabel,
    )
    replaceFilterOptions(
      manufacturerFilter,
      galleryManufacturerOptions(gallery.products),
      '全部厂商',
    )
    const isProjection = gallery.viewMode === 'prototype_projection'
    designFilterField.classList.toggle('hidden', isProjection)
    scaleFilterField.classList.toggle('hidden', isProjection)
    if (isProjection) {
      designFilter.value = 'all'
      scaleFilter.value = 'all'
    } else {
      replaceFilterOptions(designFilter, referenceProducts().map((product) => product.design), '全部造型')
      replaceFilterOptions(scaleFilter, referenceProducts().map((product) => product.scale), '全部比例')
    }
    render()
    if (gallery.status === 'running' || gallery.status === 'stopping') schedulePolling()
    else stopPolling()
  } catch (error) {
    stopPolling()
    showError(`无法读取本地图库：${error.message}`)
    title.textContent = '图库不可用'
  }
}

for (const control of [classificationFilter, manufacturerFilter, designFilter, scaleFilter, showExcluded]) {
  control.addEventListener('change', render)
}
gallerySearch.addEventListener('input', render)
detailShowExcluded.addEventListener('change', render)
document.querySelector('#lightbox-close').addEventListener('click', closeLightbox)
previousButton.addEventListener('click', () => moveLightbox(-1))
nextButton.addEventListener('click', () => moveLightbox(1))
document.querySelector('#zoom-in').addEventListener('click', () => setZoom(zoom + 0.25))
document.querySelector('#zoom-out').addEventListener('click', () => setZoom(zoom - 0.25))
document.querySelector('#zoom-fit').addEventListener('click', () => setZoom(1))
document.querySelector('#zoom-actual').addEventListener('click', () => setZoom(1, true))
lightboxStage.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    setZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25))
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
