import { createHash } from 'node:crypto'
import type { Payload } from 'payload'
import sharp from 'sharp'

import { makeSourceKey } from '@/domain/sourceKey'

type FixtureRecord = Record<string, any>
type DomainFixture = {
  candidate_records: FixtureRecord[]
  characters: FixtureRecord[]
  figure_prototypes: FixtureRecord[]
  figure_versions: FixtureRecord[]
  manufacturers: FixtureRecord[]
  media: FixtureRecord[]
  operation_logs: FixtureRecord[]
  source_records: FixtureRecord[]
  system_settings: FixtureRecord
  works: FixtureRecord[]
}

const findExisting = async (
  payload: Payload,
  collection: string,
  field: string,
  value: string,
): Promise<FixtureRecord | undefined> => {
  const result = await (payload as any).find({
    collection,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { [field]: { equals: value } },
  })
  return result.docs[0]
}

const upsert = async (
  payload: Payload,
  collection: string,
  field: string,
  value: string,
  data: Record<string, unknown>,
  draft = false,
): Promise<FixtureRecord> => {
  const existing = await findExisting(payload, collection, field, value)
  return existing
    ? (payload as any).update({ collection, data, draft, id: existing.id, overrideAccess: true })
    : (payload as any).create({ collection, data, draft, overrideAccess: true })
}

export const generateSyntheticPNG = async (generator: {
  height: number
  rgba: [number, number, number, number]
  width: number
}): Promise<Buffer> => {
  const [r, g, b, a] = generator.rgba
  return sharp({
    create: {
      background: { alpha: a / 255, b, g, r },
      channels: 4,
      height: generator.height,
      width: generator.width,
    },
  })
    .png()
    .toBuffer()
}

export const calculateAverageHash = async (bytes: Buffer): Promise<string> => {
  const pixels = await sharp(bytes).resize(8, 8, { fit: 'fill' }).greyscale().raw().toBuffer()
  const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length
  let bits = ''
  for (const value of pixels) bits += value >= mean ? '1' : '0'
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0')
}

const createMedia = async (
  payload: Payload,
  input: FixtureRecord,
  data: Record<string, unknown>,
): Promise<FixtureRecord> => {
  const existing = await findExisting(payload, 'media', 'fixtureID', input.id)
  if (existing) return existing
  const bytes = await generateSyntheticPNG(input.generator)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const perceptualHash = await calculateAverageHash(bytes)
  return (payload as any).create({
    collection: 'media',
    data: {
      byteSize: bytes.length,
      fixtureID: input.id,
      format: 'PNG',
      isAdult: input.is_adult,
      isSourceHomepage: input.is_source_homepage,
      perceptualHash,
      pixelHeight: input.generator.height,
      pixelWidth: input.generator.width,
      presentInLatestSource: input.present_in_latest_source,
      sha256,
      sourceUrl: input.source_url,
      storageKey: input.storage_key,
      ...data,
    },
    file: {
      data: bytes,
      mimetype: 'image/png',
      name: `${input.id}.png`,
      size: bytes.length,
    },
    overrideAccess: true,
  })
}

export const seedPayload = async (payload: Payload, fixture: DomainFixture) => {
  const maps = {
    candidates: new Map<string, FixtureRecord>(),
    characters: new Map<string, FixtureRecord>(),
    manufacturers: new Map<string, FixtureRecord>(),
    media: new Map<string, FixtureRecord>(),
    prototypes: new Map<string, FixtureRecord>(),
    sources: new Map<string, FixtureRecord>(),
    versions: new Map<string, FixtureRecord>(),
    works: new Map<string, FixtureRecord>(),
  }

  for (const work of fixture.works) {
    const doc = await upsert(payload, 'works', 'fixtureID', work.id, {
      aliases: work.aliases,
      fixtureID: work.id,
      name: work.name,
      originalName: work.original_name,
    })
    maps.works.set(work.id, doc)
  }

  for (const manufacturer of fixture.manufacturers) {
    const doc = await upsert(payload, 'manufacturers', 'fixtureID', manufacturer.id, {
      aliases: manufacturer.aliases,
      canonicalName: manufacturer.canonical_name,
      fixtureID: manufacturer.id,
      status: manufacturer.status,
    })
    maps.manufacturers.set(manufacturer.id, doc)
  }

  for (const character of fixture.characters) {
    const doc = await upsert(payload, 'characters', 'fixtureID', character.id, {
      aliases: character.aliases,
      displayName: character.display_name,
      fixtureID: character.id,
      nameEn: character.names.en,
      nameJa: character.names.ja,
      nameZh: character.names.zh,
      softDeleted: character.soft_deleted,
      status: character.status,
      work: maps.works.get(character.work_id)?.id,
    })
    maps.characters.set(character.id, doc)
  }

  for (const prototype of fixture.figure_prototypes) {
    const doc = await upsert(
      payload,
      'figure-prototypes',
      'fixtureID',
      prototype.id,
      {
        characters: prototype.character_ids.map((id: string) => maps.characters.get(id)?.id),
        costumeText: prototype.costume_text,
        figureType: prototype.figure_type,
        fixtureID: prototype.id,
        isAdult: prototype.is_adult,
        isGroup: prototype.is_group,
        manufacturer: maps.manufacturers.get(prototype.manufacturer_id)?.id,
        mergedInto: null,
        publicationStatus: prototype.publication_status,
        scale: prototype.scale,
        softDeleted: prototype.soft_deleted,
        title: prototype.title,
        work: maps.works.get(prototype.work_id)?.id,
      },
      prototype.publication_status === 'draft',
    )
    maps.prototypes.set(prototype.id, doc)
  }

  for (const version of fixture.figure_versions) {
    const doc = await upsert(payload, 'figure-versions', 'fixtureID', version.id, {
      fixtureID: version.id,
      kind: version.kind,
      name: version.name,
      prototype: maps.prototypes.get(version.prototype_id)?.id,
    })
    maps.versions.set(version.id, doc)
  }

  for (const source of fixture.source_records) {
    const doc = await upsert(payload, 'source-records', 'fixtureID', source.id, {
      candidateOnly: false,
      canonicalUrl: source.source_url,
      fixtureID: source.id,
      invalidated: source.is_stale,
      lastSyncedAt: source.last_synced_at,
      prototype: maps.prototypes.get(source.prototype_id)?.id,
      rawSnapshot: source.raw_snapshot,
      sourceItemId: source.source_item_id,
      sourceKey: makeSourceKey({
        sourceItemId: source.source_item_id,
        sourceType: source.source_type,
        sourceUrl: source.source_url,
      }),
      sourceType: source.source_type,
      sourceUrl: source.source_url,
      status: source.source_status,
    })
    maps.sources.set(source.id, doc)
  }

  for (const candidate of fixture.candidate_records) {
    const sourceKey = makeSourceKey({
      sourceItemId: candidate.source.source_item_id,
      sourceType: candidate.source.source_type,
      sourceUrl: candidate.source.source_url,
    })
    const source = await upsert(payload, 'source-records', 'sourceKey', sourceKey, {
      candidateOnly: true,
      canonicalUrl: candidate.source.source_url,
      invalidated: candidate.source.is_stale,
      lastSyncedAt: candidate.source.last_synced_at,
      rawSnapshot: candidate.raw_snapshot,
      sourceItemId: candidate.source.source_item_id,
      sourceKey,
      sourceType: candidate.source.source_type,
      sourceUrl: candidate.source.source_url,
      status: candidate.source.source_status,
    })
    const doc = await upsert(payload, 'candidate-records', 'externalKey', candidate.id, {
      externalKey: candidate.id,
      matchState: candidate.match_state,
      proposedManufacturerStatus: candidate.proposed_manufacturer_status,
      rawCategory: candidate.raw_category,
      rawCharacterNames: candidate.raw_character_names,
      rawDate: candidate.raw_date,
      rawManufacturer: candidate.raw_manufacturer,
      rawScale: candidate.raw_scale,
      rawSnapshot: candidate.raw_snapshot,
      rawTitle: candidate.raw_title,
      rawWorkName: candidate.raw_work_name,
      reason: candidate.reason,
      requestedChanges: candidate.requested_changes,
      source: source.id,
      status: candidate.status,
      targetPrototype: maps.prototypes.get(candidate.target_prototype_id)?.id,
      targetVersion: maps.versions.get(candidate.target_version_id)?.id,
    })
    maps.candidates.set(candidate.id, doc)
  }

  for (const candidate of fixture.candidate_records) {
    const mediaIDs: number[] = []
    for (const image of candidate.images) {
      const media = await createMedia(payload, image, {
        candidate: maps.candidates.get(candidate.id)?.id,
        candidateOnly: true,
        selectedAsMain: false,
      })
      maps.media.set(image.id, media)
      mediaIDs.push(media.id)
    }
    await (payload as any).update({
      collection: 'candidate-records',
      data: { images: mediaIDs },
      id: maps.candidates.get(candidate.id)!.id,
      overrideAccess: true,
    })
  }

  for (const image of fixture.media) {
    const media = await createMedia(payload, image, {
      candidateOnly: false,
      prototype: maps.prototypes.get(image.owner_id)?.id,
      selectedAsMain: image.manually_selected_as_main,
    })
    maps.media.set(image.id, media)
  }

  for (const prototype of fixture.figure_prototypes) {
    if (!prototype.main_image_id) continue
    await (payload as any).update({
      collection: 'figure-prototypes',
      context: { syntheticSeed: true },
      data: { mainImage: maps.media.get(prototype.main_image_id)?.id },
      id: maps.prototypes.get(prototype.id)!.id,
      overrideAccess: true,
    })
  }

  for (const operation of fixture.operation_logs) {
    await upsert(payload, 'operation-logs', 'fixtureID', operation.id, {
      actorLabel: operation.actor,
      afterState: operation.after,
      beforeState: operation.before,
      fixtureID: operation.id,
      operationType: operation.operation_type,
      reason: operation.reason,
      relatedRecords: operation.related_record_ids,
      undone: operation.is_undone,
    })
  }

  await payload.updateGlobal({
    data: {
      galleryPageSize: fixture.system_settings.gallery_page_size,
      publicReadEnabled: fixture.system_settings.public_read_enabled,
      showAdultImages: fixture.system_settings.show_adult_images,
    },
    overrideAccess: true,
    slug: 'system-settings',
  })

  return maps
}
