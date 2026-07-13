import { getPayload } from 'payload'
import type { Where } from 'payload'

export type CharacterHit = {
  displayName: string
  id: number | string
  workName: string
}

export type CharacterSearchResolution =
  | { kind: 'disambiguation'; matches: CharacterHit[] }
  | { kind: 'none'; matches: [] }
  | { kind: 'unique'; match: CharacterHit; target: string }

export type GalleryImage = {
  alt: string
  height?: number
  id: number | string
  isGroup: boolean
  url: string
  width?: number
}

const relationID = (value: unknown): null | number | string => {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

const publicPayload = async () => {
  const { default: config } = await import('@payload-config')
  return getPayload({ config })
}

export const searchCharacters = async (query: string): Promise<CharacterHit[]> => {
  const payload = await publicPayload()
  const normalized = query.trim()
  if (!normalized) return []
  const settings = await payload.findGlobal({ slug: 'system-settings', overrideAccess: false })
  if (!settings.publicReadEnabled) return []
  const result = await payload.find({
    collection: 'characters',
    depth: 1,
    limit: 50,
    overrideAccess: false,
    where: {
      and: [
        { status: { equals: 'active' } },
        { softDeleted: { equals: false } },
        {
          or: [
            { displayName: { equals: normalized } },
            { nameZh: { equals: normalized } },
            { nameJa: { equals: normalized } },
            { nameEn: { equals: normalized } },
            { aliases: { contains: normalized } },
          ],
        },
      ],
    },
  })
  return result.docs.map((doc) => ({
    displayName: String(doc.displayName),
    id: doc.id,
    workName:
      doc.work && typeof doc.work === 'object' ? String(doc.work.name ?? '未关联作品') : '未关联作品',
  }))
}

export const resolveCharacterMatches = (
  matches: CharacterHit[],
): CharacterSearchResolution => {
  if (matches.length === 0) return { kind: 'none', matches: [] }
  if (matches.length === 1) {
    return { kind: 'unique', match: matches[0], target: `/characters/${matches[0].id}` }
  }
  return { kind: 'disambiguation', matches }
}

export const getCharacterGallery = async (characterID: number | string, page: number) => {
  const payload = await publicPayload()
  const settings = await payload.findGlobal({ slug: 'system-settings', overrideAccess: false })
  if (!settings.publicReadEnabled) throw new Error('Public gallery access is disabled.')
  const pageSize = Number(settings.galleryPageSize ?? 16)
  const character = await payload.findByID({
    collection: 'characters',
    depth: 0,
    id: characterID,
    overrideAccess: false,
  })
  if (character.status !== 'active' || character.softDeleted) {
    throw new Error('Character is not publicly available.')
  }
  const filters: Where[] = [
    { characters: { contains: characterID } },
    { mainImage: { exists: true } },
    { 'mainImage.candidateOnly': { equals: false } },
    { 'manufacturer.status': { equals: 'active' } },
  ]
  if (!settings.showAdultImages) filters.push({ 'mainImage.isAdult': { equals: false } })
  const prototypeResult = await payload.find({
    collection: 'figure-prototypes',
    depth: 0,
    limit: pageSize,
    overrideAccess: false,
    page: Math.max(1, page),
    sort: 'id',
    where: {
      and: [
        ...filters,
      ],
    },
  })

  const images: GalleryImage[] = []
  for (const prototype of prototypeResult.docs) {
    const mediaID = relationID(prototype.mainImage)
    if (!mediaID) continue
    const media = await payload.findByID({
      collection: 'media',
      depth: 0,
      id: mediaID,
      overrideAccess: true,
    })
    if (media.candidateOnly || !media.url) continue
    if (media.isAdult && !settings.showAdultImages) continue
    images.push({
      alt: String(prototype.title),
      height: media.height ?? media.pixelHeight ?? undefined,
      id: prototype.id,
      isGroup: Boolean(prototype.isGroup),
      url: media.url,
      width: media.width ?? media.pixelWidth ?? undefined,
    })
  }

  return {
    characterName: String(character.displayName),
    images,
    page: prototypeResult.page ?? 1,
    totalPages: prototypeResult.totalPages,
  }
}
