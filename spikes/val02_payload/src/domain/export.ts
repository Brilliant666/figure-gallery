import type { Payload } from 'payload'

const exportCollections = [
  'works',
  'characters',
  'manufacturers',
  'figure-prototypes',
  'figure-versions',
  'source-records',
  'candidate-records',
  'media',
  'operation-logs',
] as const

const relationID = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(relationID)
  if (value && typeof value === 'object' && 'id' in value) return (value as { id: unknown }).id
  return value
}

const sanitizedDocument = (doc: Record<string, unknown>) => {
  const excluded = new Set([
    '_status',
    'apiKey',
    'apiKeyIndex',
    'createdAt',
    'deletedAt',
    'filename',
    'filesize',
    'hash',
    'mimeType',
    'password',
    'salt',
    'sizes',
    'thumbnailURL',
    'updatedAt',
    'url',
  ])
  return Object.fromEntries(
    Object.entries(doc)
      .filter(([key]) => !excluded.has(key))
      .map(([key, value]) => [key, relationID(value)]),
  )
}

export const buildJSONExport = async (payload: Payload) => {
  const collections: Record<string, Record<string, unknown>[]> = {}
  for (const collection of exportCollections) {
    const result = await payload.find({
      collection,
      depth: 0,
      limit: 0,
      overrideAccess: true,
      showHiddenFields: false,
    })
    collections[collection] = result.docs.map((doc) =>
      sanitizedDocument(doc as unknown as Record<string, unknown>),
    )
  }
  const settings = await payload.findGlobal({
    overrideAccess: true,
    slug: 'system-settings',
  })
  return {
    collections,
    format: 'figure-gallery-open-export',
    schema_version: 1,
    system_settings: sanitizedDocument(settings as unknown as Record<string, unknown>),
  }
}

const scalar = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const csvEscape = (value: unknown): string => {
  const text = scalar(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export const buildCSVExports = (
  data: Awaited<ReturnType<typeof buildJSONExport>>,
): Record<string, string> => {
  const files: Record<string, string> = {}
  for (const [collection, docs] of Object.entries(data.collections)) {
    const headers = [...new Set(docs.flatMap((doc) => Object.keys(doc)))].sort()
    files[`${collection}.csv`] = [
      headers.map(csvEscape).join(','),
      ...docs.map((doc) => headers.map((header) => csvEscape(doc[header])).join(',')),
    ].join('\n')
  }
  return files
}

export const exportFieldGuide = {
  ids: 'Payload document IDs are stable within an export; fixtureID/externalKey preserve synthetic identity.',
  media:
    'Media rows contain storageKey, sourceUrl, sha256, perceptualHash and dimensions; binaries and generated URLs are excluded.',
  relationships: 'Relationship values are exported as IDs or arrays of IDs.',
}
