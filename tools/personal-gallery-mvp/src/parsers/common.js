export function cleanText(value) {
  if (value === null || value === undefined) return null
  const cleaned = String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || null
}

export function normalizedText(value) {
  return (cleanText(value) || '').normalize('NFKC').toLocaleLowerCase('zh-CN')
}

export function splitNames(value) {
  const text = cleanText(value)
  if (!text) return []
  return [...new Set(text.split(/[、,，;；|｜\n]+/).map(cleanText).filter(Boolean))]
}

export function parseJsonLdDocuments($) {
  const values = []
  $('script[type="application/ld+json"]').each((_index, node) => {
    const raw = $(node).text().trim()
    if (!raw) return
    try {
      values.push(JSON.parse(raw))
    } catch {
      values.push({ __parseError: true })
    }
  })
  return values
}

function typeIncludes(value, wanted) {
  const types = Array.isArray(value?.['@type']) ? value['@type'] : [value?.['@type']]
  return types.some((type) => String(type).toLocaleLowerCase('en-US') === wanted.toLocaleLowerCase('en-US'))
}

export function findJsonLdByType(value, wantedType, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  if (typeIncludes(value, wantedType)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonLdByType(item, wantedType, seen)
      if (found) return found
    }
    return null
  }
  for (const item of Object.values(value)) {
    const found = findJsonLdByType(item, wantedType, seen)
    if (found) return found
  }
  return null
}

export function firstText($, selectors) {
  for (const selector of selectors) {
    const value = cleanText($(selector).first().text())
    if (value) return value
  }
  return null
}

export function firstAttribute($, selectors, attribute) {
  for (const selector of selectors) {
    const value = cleanText($(selector).first().attr(attribute))
    if (value) return value
  }
  return null
}
