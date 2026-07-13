import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Payload, PayloadRequest } from 'payload'
import { createLocalReq, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildCSVExports, buildJSONExport } from '@/domain/export'
import { loadDomainFixture } from '@/domain/fixture'
import {
  mergePrototypes,
  splitPrototype,
  undoLastMergeOrSplit,
} from '@/domain/payloadDomainService'
import { seedPayload } from '@/domain/seed'
import { calculateAverageHash, generateSyntheticPNG } from '@/domain/seed'
import { candidateReviewEndpoint } from '@/endpoints/candidateReview'
import { candidateUpsertEndpoint } from '@/endpoints/candidateUpsert'
import {
  getCharacterGallery,
  resolveCharacterMatches,
  searchCharacters,
} from '@/lib/gallery'

type Doc = Record<string, any>

let payload: Payload
let tempDir: string
let mediaDir: string
let maps: Awaited<ReturnType<typeof seedPayload>>
let fixture: Doc
let admin: Doc
let candidateUser: Doc
let secondCandidateUser: Doc
let candidateAPIKey: string

const fixtureDoc = (map: Map<string, Doc>, id: string): Doc => {
  const doc = map.get(id)
  if (!doc) throw new Error(`Missing fixture map entry: ${id}`)
  return doc
}

const jsonRequest = async (user: Doc, body: Record<string, unknown>): Promise<PayloadRequest> => {
  const req = await createLocalReq({ user: user as any }, payload)
  Object.defineProperty(req, 'json', {
    configurable: true,
    value: async () => structuredClone(body),
  })
  return req
}

const relationID = (value: unknown): unknown =>
  value && typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : value

const parseCSV = (input: string): Record<string, string>[] => {
  const rows: string[][] = []
  let current = ''
  let fields: string[] = []
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      fields.push(current)
      current = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      fields.push(current)
      rows.push(fields)
      current = ''
      fields = []
    } else {
      current += character
    }
  }
  if (current || fields.length) {
    fields.push(current)
    rows.push(fields)
  }
  const [headers = [], ...data] = rows
  return data
    .filter((row) => row.some((value) => value !== ''))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
}

describe.sequential('real Payload SQLite integration', () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-payload-vitest-'))
    mediaDir = path.join(tempDir, 'media')
    process.env.DATABASE_URI = `file:${path.join(tempDir, 'payload.db').replaceAll('\\', '/')}`
    process.env.MEDIA_DIR = mediaDir
    process.env.PAYLOAD_SECRET = randomBytes(48).toString('hex')
    process.env.S3_ENABLED = 'false'

    const { fixture: loadedFixture } = await loadDomainFixture<Doc>()
    fixture = loadedFixture
    const { default: config } = await import('@payload-config')
    payload = await getPayload({ config })
    maps = await seedPayload(payload, fixture as never)

    const adminPassword = randomBytes(24).toString('base64url')
    admin = await payload.create({
      collection: 'users',
      data: {
        email: `admin-${randomUUID()}@synthetic.invalid`,
        password: adminPassword,
        role: 'admin',
      },
      overrideAccess: true,
      showHiddenFields: true,
    })
    candidateAPIKey = randomBytes(32).toString('base64url')
    candidateUser = await payload.create({
      collection: 'users',
      data: {
        apiKey: candidateAPIKey,
        email: `candidate-${randomUUID()}@synthetic.invalid`,
        enableAPIKey: true,
        password: randomBytes(24).toString('base64url'),
        role: 'candidate-client',
      },
      overrideAccess: true,
      showHiddenFields: true,
    })
    secondCandidateUser = await payload.create({
      collection: 'users',
      data: {
        apiKey: randomBytes(32).toString('base64url'),
        email: `candidate-second-${randomUUID()}@synthetic.invalid`,
        enableAPIKey: true,
        password: randomBytes(24).toString('base64url'),
        role: 'candidate-client',
      },
      overrideAccess: true,
      showHiddenFields: true,
    })
  }, 120_000)

  afterAll(async () => {
    if (payload) await payload.destroy()
    const resolved = path.resolve(tempDir)
    const tempRoot = path.resolve(os.tmpdir())
    if (resolved.startsWith(`${tempRoot}${path.sep}`)) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await rm(resolved, { force: true, recursive: true })
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 4) break
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
        }
      }
    }
  })

  it('authenticates a runtime-generated Payload API key with the users slug', async () => {
    const auth = await payload.auth({
      headers: new Headers({ authorization: `users API-Key ${candidateAPIKey}` }),
    })
    expect(auth.user?.id).toBe(candidateUser.id)
    expect((auth.user as Doc).role).toBe('candidate-client')
  })

  it('makes OperationLog append-only outside controlled domain services', async () => {
    const req = await createLocalReq({ user: admin as any }, payload)
    await expect(
      payload.create({
        collection: 'operation-logs',
        data: {
          actorLabel: 'forged',
          afterState: {},
          beforeState: {},
          operationType: 'candidate_upsert',
          reason: 'forged',
          relatedRecords: {},
          undone: false,
        },
        overrideAccess: false,
        req,
      }),
    ).rejects.toThrow()
    const logs = await payload.find({
      collection: 'operation-logs',
      limit: 1,
      overrideAccess: true,
      where: { fixtureID: { equals: 'operation-select-main-p1' } },
    })
    const existing = logs.docs[0]
    expect(existing).toBeTruthy()
    await expect(
      payload.update({
        collection: 'operation-logs',
        data: { reason: 'tampered' },
        id: existing.id,
        overrideAccess: false,
        req,
      }),
    ).rejects.toThrow()
  })

  it('closes generic formal and global CRUD while controlled services remain available', async () => {
    const req = await createLocalReq({ user: admin as any }, payload)
    const formalCollections = [
      {
        collection: 'works',
        createData: { name: 'Forbidden generic work' },
        id: fixtureDoc(maps.works, 'work-orbit-chronicles').id,
        updateData: { name: 'Forbidden work edit' },
      },
      {
        collection: 'characters',
        createData: { displayName: 'Forbidden generic character', status: 'active' },
        id: fixtureDoc(maps.characters, 'character-aya').id,
        updateData: { displayName: 'Forbidden character edit' },
      },
      {
        collection: 'manufacturers',
        createData: { canonicalName: 'Forbidden generic manufacturer', status: 'active' },
        id: fixtureDoc(maps.manufacturers, 'manufacturer-aurora').id,
        updateData: { status: 'hidden' },
      },
      {
        collection: 'figure-prototypes',
        createData: {
          characters: [fixtureDoc(maps.characters, 'character-aya').id],
          figureType: 'scale',
          manufacturer: fixtureDoc(maps.manufacturers, 'manufacturer-aurora').id,
          title: 'Forbidden generic prototype',
        },
        id: fixtureDoc(maps.prototypes, 'prototype-orbit-duo').id,
        updateData: { publicationStatus: 'hidden' },
      },
      {
        collection: 'figure-versions',
        createData: {
          kind: 'standard',
          name: 'Forbidden generic version',
          prototype: fixtureDoc(maps.prototypes, 'prototype-orbit-duo').id,
        },
        id: fixtureDoc(maps.versions, 'version-p1-standard').id,
        updateData: { name: 'Forbidden version edit' },
      },
    ] as const

    for (const item of formalCollections) {
      await expect(
        (payload as any).create({
          collection: item.collection,
          data: item.createData,
          overrideAccess: false,
          req,
        }),
      ).rejects.toThrow()
      await expect(
        (payload as any).update({
          collection: item.collection,
          data: item.updateData,
          id: item.id,
          overrideAccess: false,
          req,
        }),
      ).rejects.toThrow()
      await expect(
        (payload as any).delete({
          collection: item.collection,
          id: item.id,
          overrideAccess: false,
          req,
        }),
      ).rejects.toThrow()
    }

    await expect(
      payload.updateGlobal({
        data: { showAdultImages: true },
        overrideAccess: false,
        req,
        slug: 'system-settings',
      }),
    ).rejects.toThrow()
    const settings = await payload.findGlobal({ overrideAccess: true, slug: 'system-settings' })
    expect(settings.showAdultImages).toBe(false)
  })

  it('closes every anonymous formal collection read when public access is disabled', async () => {
    const disabled = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'update-settings',
        reason: 'Verify public collection access closes atomically',
        settings: { publicReadEnabled: false },
      }),
    )
    expect(disabled.status, await disabled.clone().text()).toBe(200)

    const blockedReads = [
      () => payload.find({
        collection: 'works',
        overrideAccess: false,
        where: { id: { equals: fixtureDoc(maps.works, 'work-orbit-chronicles').id } },
      }),
      () => payload.find({
        collection: 'characters',
        overrideAccess: false,
        where: { id: { equals: fixtureDoc(maps.characters, 'character-aya').id } },
      }),
      () => payload.find({
        collection: 'manufacturers',
        overrideAccess: false,
        where: { id: { equals: fixtureDoc(maps.manufacturers, 'manufacturer-aurora').id } },
      }),
      () => payload.find({
        collection: 'figure-prototypes',
        overrideAccess: false,
        where: {
          id: { equals: fixtureDoc(maps.prototypes, 'prototype-orbit-lin-aurora').id },
        },
      }),
      () => payload.find({
        collection: 'media',
        overrideAccess: false,
        where: { id: { equals: fixtureDoc(maps.media, 'media-prototype-01-main').id } },
      }),
    ]

    try {
      for (const read of blockedReads) await expect(read()).rejects.toThrow()
    } finally {
      const restored = await candidateReviewEndpoint.handler(
        await jsonRequest(admin, {
          action: 'update-settings',
          reason: 'Restore public collection access after boundary test',
          settings: { publicReadEnabled: true },
        }),
      )
      expect(restored.status, await restored.clone().text()).toBe(200)
    }
    const visibleWork = await payload.find({
      collection: 'works',
      overrideAccess: false,
      where: { id: { equals: fixtureDoc(maps.works, 'work-orbit-chronicles').id } },
    })
    expect(visibleWork.totalDocs).toBe(1)
  })

  it('keeps candidate access out of formal entities and main-image writes', async () => {
    const req = await createLocalReq({ user: candidateUser as any }, payload)
    await expect(
      payload.create({
        collection: 'figure-prototypes',
        data: {
          characters: [fixtureDoc(maps.characters, 'character-lin-orbit').id],
          figureType: 'scale',
          manufacturer: fixtureDoc(maps.manufacturers, 'manufacturer-aurora').id,
          title: 'Forbidden candidate prototype',
        },
        draft: true,
        overrideAccess: false,
        req,
      }),
    ).rejects.toThrow()

    const protectedPrototype = fixtureDoc(maps.prototypes, 'prototype-orbit-lin-aurora')
    const candidateImage = fixtureDoc(maps.media, 'candidate-image-002-b')
    await expect(
      payload.update({
        collection: 'figure-prototypes',
        data: { mainImage: candidateImage.id },
        id: protectedPrototype.id,
        overrideAccess: false,
        req,
      }),
    ).rejects.toThrow()
    const unchanged = await payload.findByID({
      collection: 'figure-prototypes',
      depth: 0,
      id: protectedPrototype.id,
      overrideAccess: true,
    })
    expect(relationID(unchanged.mainImage)).toBe(
      fixtureDoc(maps.media, 'media-prototype-01-main').id,
    )

    const adminReq = await createLocalReq({ user: admin as any }, payload)
    await expect(
      payload.update({
        collection: 'figure-prototypes',
        data: { mainImage: candidateImage.id },
        id: protectedPrototype.id,
        overrideAccess: false,
        req: adminReq,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'figure-prototypes',
        data: { mainImage: candidateImage.id },
        id: protectedPrototype.id,
        overrideAccess: true,
        req: adminReq,
      }),
    ).rejects.toThrow('audited administrator review action')
  })

  it('performs idempotent candidate/source/media metadata upsert and rejects formal fields', async () => {
    const [charactersBefore, manufacturersBefore] = await Promise.all([
      payload.count({ collection: 'characters', overrideAccess: true }),
      payload.count({ collection: 'manufacturers', overrideAccess: true }),
    ])
    const body = {
      candidate: {
        id: 'candidate-http-integration',
        images: [
          {
            file_size: 88,
            format: 'PNG',
            height: 3,
            id: 'candidate-http-image',
            is_adult: false,
            is_source_homepage: true,
            perceptual_hash: 'ffffffffffffffff',
            present_in_latest_source: true,
            sha256: 'a'.repeat(64),
            source_url: 'https://synthetic.invalid/candidate-http/image.png',
            storage_key: 'synthetic/candidate-http/image.png',
            width: 2,
          },
        ],
        match_state: 'character_pending',
        proposed_manufacturer_status: 'draft',
        raw_character_names: ['Synthetic New'],
        raw_snapshot: { revision: 1 },
        raw_title: 'Synthetic candidate via API',
        requested_changes: { main_image_id: 'proposal-only' },
        source: {
          is_stale: false,
          source_item_id: 'HTTP-1',
          source_status: 'active',
          source_type: 'synthetic_feed',
          source_url: 'https://synthetic.invalid/candidate-http',
        },
      },
      operation: 'candidate_upsert',
      protocol_version: 1,
    }
    const first = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, body),
    )
    const second = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, body),
    )
    expect(first.status, await first.clone().text()).toBe(201)
    expect(second.status, await second.clone().text()).toBe(200)

    const sameSourceNewExternalID = structuredClone(body)
    sameSourceNewExternalID.candidate.id = 'must-not-create-a-second-candidate'
    sameSourceNewExternalID.candidate.raw_title = 'Same source, changed title'
    const third = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, sameSourceNewExternalID),
    )
    expect(third.status, await third.clone().text()).toBe(200)
    const candidates = await payload.find({
      collection: 'candidate-records',
      depth: 0,
      overrideAccess: true,
      where: { externalKey: { equals: 'candidate-http-integration' } },
    })
    expect(candidates.totalDocs).toBe(1)
    expect(candidates.docs[0].rawTitle).toBe('Same source, changed title')
    expect(candidates.docs[0].matchState).toBe('character_pending')
    expect(candidates.docs[0].targetPrototype).toBeFalsy()
    expect(candidates.docs[0].requestedChanges).toEqual({ main_image_id: 'proposal-only' })
    const media = await payload.find({
      collection: 'media',
      depth: 0,
      overrideAccess: true,
      where: { storageKey: { equals: 'synthetic/candidate-http/image.png' } },
    })
    expect(media.totalDocs).toBe(1)
    expect(media.docs[0]).toMatchObject({ candidateOnly: true, selectedAsMain: false })

    const source = await payload.findByID({
      collection: 'source-records',
      depth: 0,
      id: relationID(candidates.docs[0].source) as number,
      overrideAccess: true,
    })
    expect(source.candidateOnly).toBe(true)
    expect(relationID(source.candidateOwner)).toBe(candidateUser.id)

    const candidateReq = await createLocalReq({ user: candidateUser as any }, payload)
    await expect(
      payload.update({
        collection: 'source-records',
        data: { status: 'missing' },
        id: source.id,
        overrideAccess: false,
        req: candidateReq,
      }),
    ).rejects.toThrow()

    const formalSource = fixtureDoc(maps.sources, 'source-p1')
    await expect(
      payload.update({
        collection: 'source-records',
        data: { prototype: null, status: 'missing' },
        id: formalSource.id,
        overrideAccess: false,
        req: candidateReq,
      }),
    ).rejects.toThrow()
    const unchangedFormalSource = await payload.findByID({
      collection: 'source-records',
      depth: 0,
      id: formalSource.id,
      overrideAccess: true,
    })
    expect(relationID(unchangedFormalSource.prototype)).toBe(
      fixtureDoc(maps.prototypes, 'prototype-orbit-lin-aurora').id,
    )

    const logs = await payload.find({
      collection: 'operation-logs',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      sort: '-createdAt',
      where: { operationType: { equals: 'candidate_upsert' } },
    })
    expect((logs.docs[0].beforeState as Doc).candidate).not.toBeNull()
    expect((logs.docs[0].afterState as Doc).candidate.rawTitle).toBe(
      'Same source, changed title',
    )

    const forbidden = structuredClone(body) as Doc
    forbidden.candidate.main_image_id = fixtureDoc(maps.media, 'candidate-image-002-b').id
    const rejected = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, forbidden),
    )
    expect(rejected.status).toBe(403)

    const secondClientAttempt = await candidateUpsertEndpoint.handler(
      await jsonRequest(secondCandidateUser, body),
    )
    expect(secondClientAttempt.status).toBe(400)

    const formalSourceAttack = structuredClone(body)
    formalSourceAttack.candidate.id = 'formal-source-attack'
    formalSourceAttack.candidate.source = {
      is_stale: false,
      source_item_id: 'SYN-001',
      source_status: 'active',
      source_type: 'synthetic_catalog',
      source_url: 'https://synthetic.invalid/items/SYN-001',
    }
    const formalSourceRejected = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, formalSourceAttack),
    )
    expect(formalSourceRejected.status).toBe(400)
    const adminCannotUseCandidateEndpoint = await candidateUpsertEndpoint.handler(
      await jsonRequest(admin, formalSourceAttack),
    )
    expect(adminCannotUseCandidateEndpoint.status).toBe(403)
    const [charactersAfter, manufacturersAfter] = await Promise.all([
      payload.count({ collection: 'characters', overrideAccess: true }),
      payload.count({ collection: 'manufacturers', overrideAccess: true }),
    ])
    expect(charactersAfter.totalDocs).toBe(charactersBefore.totalDocs)
    expect(manufacturersAfter.totalDocs).toBe(manufacturersBefore.totalDocs)
  })

  it('migrates a URL fallback source identity to a stable source ID without duplication', async () => {
    const marker = randomUUID()
    const candidate: Doc = {
      id: `url-fallback-${marker}`,
      images: [],
      raw_character_names: ['Fallback'],
      raw_snapshot: { revision: 1 },
      raw_title: 'URL fallback candidate',
      source: {
        source_item_id: null,
        source_status: 'active',
        source_type: 'synthetic_feed',
        source_url: `https://synthetic.invalid/url-fallback/${marker}?utm_source=first`,
      },
    }
    const first = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, {
        candidate,
        operation: 'candidate_upsert',
        protocol_version: 1,
      }),
    )
    expect(first.status).toBe(201)
    const firstResult = (await first.clone().json()) as Doc
    const withStableID = structuredClone(candidate)
    withStableID.source.source_item_id = `STABLE-${marker}`
    withStableID.source.source_url = `https://synthetic.invalid/url-fallback/${marker}`
    const second = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, {
        candidate: withStableID,
        operation: 'candidate_upsert',
        protocol_version: 1,
      }),
    )
    expect(second.status).toBe(200)
    const secondResult = (await second.clone().json()) as Doc
    expect(secondResult.source_id).toBe(firstResult.source_id)
    expect(secondResult.candidate_id).toBe(firstResult.candidate_id)
    const sources = await payload.find({
      collection: 'source-records',
      overrideAccess: true,
      where: { sourceItemId: { equals: `STABLE-${marker}` } },
    })
    expect(sources.totalDocs).toBe(1)
    expect(sources.docs[0].sourceKey).toBe(`synthetic_feed:id:STABLE-${marker}`)
    const [allMarkerSources, markerCandidates] = await Promise.all([
      payload.count({
        collection: 'source-records',
        overrideAccess: true,
        where: {
          canonicalUrl: { equals: `https://synthetic.invalid/url-fallback/${marker}` },
        },
      }),
      payload.count({
        collection: 'candidate-records',
        overrideAccess: true,
        where: { externalKey: { equals: candidate.id } },
      }),
    ])
    expect(allMarkerSources.totalDocs).toBe(1)
    expect(markerCandidates.totalDocs).toBe(1)
  })

  it('closes generic candidate, source and media collection writes for candidate clients', async () => {
    const candidate = fixtureDoc(maps.candidates, 'candidate-main-image-attack')
    const media = fixtureDoc(maps.media, 'candidate-image-002-a')
    const req = await createLocalReq({ user: secondCandidateUser as any }, payload)
    await expect(
      payload.find({
        collection: 'candidate-records',
        overrideAccess: false,
        req,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'candidate-records',
        data: { rawTitle: 'Cross-client mutation' },
        id: candidate.id,
        overrideAccess: false,
        req,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'media',
        data: { sourceUrl: 'https://synthetic.invalid/cross-client.png' },
        id: media.id,
        overrideAccess: false,
        req,
      }),
    ).rejects.toThrow()
  })

  it('rolls back the whole candidate upsert when a late operation-log write fails', async () => {
    const marker = randomUUID()
    const body = {
      candidate: {
        id: `rollback-${marker}`,
        images: [
          {
            format: 'PNG',
            height: 2,
            id: `rollback-image-${marker}`,
            is_adult: false,
            is_source_homepage: true,
            present_in_latest_source: true,
            source_url: `https://synthetic.invalid/rollback/${marker}.png`,
            storage_key: `synthetic/rollback/${marker}.png`,
            width: 2,
          },
        ],
        raw_character_names: ['Rollback only'],
        raw_snapshot: { marker },
        raw_title: 'Rollback candidate',
        source: {
          source_item_id: `ROLLBACK-${marker}`,
          source_status: 'active',
          source_type: 'synthetic_feed',
          source_url: `https://synthetic.invalid/rollback/${marker}`,
        },
      },
      operation: 'candidate_upsert' as const,
      protocol_version: 1 as const,
    }
    const req = await jsonRequest(candidateUser, body)
    req.context = { ...req.context, testFailBeforeOperationLog: true }
    const failed = await candidateUpsertEndpoint.handler(req)
    expect(failed.status).toBe(400)
    const [candidateCount, sourceCount, mediaCount] = await Promise.all([
      payload.count({
        collection: 'candidate-records',
        overrideAccess: true,
        where: { externalKey: { equals: body.candidate.id } },
      }),
      payload.count({
        collection: 'source-records',
        overrideAccess: true,
        where: { sourceItemId: { equals: body.candidate.source.source_item_id } },
      }),
      payload.count({
        collection: 'media',
        overrideAccess: true,
        where: { storageKey: { equals: body.candidate.images[0].storage_key } },
      }),
    ])
    expect(candidateCount.totalDocs).toBe(0)
    expect(sourceCount.totalDocs).toBe(0)
    expect(mediaCount.totalDocs).toBe(0)
  })

  it('rejects a storage-key collision with formal media without changing the published main image', async () => {
    const marker = randomUUID()
    const prototype = fixtureDoc(maps.prototypes, 'prototype-moon-ren-prize')
    const formalMedia = fixtureDoc(maps.media, 'media-prototype-05-main')
    const beforeLogs = await payload.count({ collection: 'operation-logs', overrideAccess: true })
    const response = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, {
        candidate: {
          id: `formal-media-attack-${marker}`,
          images: [
            {
              format: 'PNG',
              id: `formal-media-attack-image-${marker}`,
              is_adult: false,
              is_source_homepage: true,
              present_in_latest_source: true,
              source_url: `https://synthetic.invalid/formal-media-attack/${marker}.png`,
              storage_key: formalMedia.storageKey,
            },
          ],
          raw_character_names: ['Attack'],
          raw_snapshot: { marker },
          raw_title: 'Formal media collision attack',
          source: {
            source_item_id: `MEDIA-ATTACK-${marker}`,
            source_status: 'active',
            source_type: 'synthetic_feed',
            source_url: `https://synthetic.invalid/formal-media-attack/${marker}`,
          },
        },
        operation: 'candidate_upsert',
        protocol_version: 1,
      }),
    )
    expect(response.status).toBe(400)
    const [afterMedia, afterPrototype, attackCandidate, attackSource, afterLogs] = await Promise.all([
      payload.findByID({ collection: 'media', depth: 0, id: formalMedia.id, overrideAccess: true }),
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: prototype.id,
        overrideAccess: true,
      }),
      payload.count({
        collection: 'candidate-records',
        overrideAccess: true,
        where: { externalKey: { equals: `formal-media-attack-${marker}` } },
      }),
      payload.count({
        collection: 'source-records',
        overrideAccess: true,
        where: { sourceItemId: { equals: `MEDIA-ATTACK-${marker}` } },
      }),
      payload.count({ collection: 'operation-logs', overrideAccess: true }),
    ])
    expect(afterMedia).toMatchObject({ candidateOnly: false, selectedAsMain: true })
    expect(relationID(afterMedia.prototype)).toBe(prototype.id)
    expect(relationID(afterPrototype.mainImage)).toBe(formalMedia.id)
    expect(attackCandidate.totalDocs).toBe(0)
    expect(attackSource.totalDocs).toBe(0)
    expect(afterLogs.totalDocs).toBe(beforeLogs.totalDocs)
  })

  it('applies accepted fields but only links a candidate to an existing version', async () => {
    const candidate = fixtureDoc(maps.candidates, 'candidate-main-image-attack')
    const prototype = fixtureDoc(maps.prototypes, 'prototype-orbit-lin-aurora')
    const version = fixtureDoc(maps.versions, 'version-p1-standard')
    const beforeVersionCount = await payload.count({ collection: 'figure-versions', overrideAccess: true })
    const galleryCharacter = fixtureDoc(maps.characters, 'character-lin-orbit')
    const beforeGallery = await getCharacterGallery(galleryCharacter.id, 1)

    const accepted = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'accept-field',
        candidateID: candidate.id,
        field: 'scale',
        prototypeID: prototype.id,
        reason: 'Verify AC-11 whitelist update',
        value: '1/9',
      }),
    )
    expect(accepted.status).toBe(200)
    const updatedPrototype = await payload.findByID({
      collection: 'figure-prototypes',
      depth: 0,
      id: prototype.id,
      overrideAccess: true,
    })
    expect(updatedPrototype.scale).toBe('1/9')

    const attached = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'attach-version',
        candidateID: candidate.id,
        prototypeID: prototype.id,
        reason: 'Verify AC-10 existing version link',
        versionID: version.id,
      }),
    )
    expect(attached.status).toBe(200)
    const afterVersionCount = await payload.count({ collection: 'figure-versions', overrideAccess: true })
    expect(afterVersionCount.totalDocs).toBe(beforeVersionCount.totalDocs)
    const afterGallery = await getCharacterGallery(galleryCharacter.id, 1)
    expect(afterGallery.images.map((image) => image.id)).toEqual(
      beforeGallery.images.map((image) => image.id),
    )
    const updatedCandidate = await payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: candidate.id,
      overrideAccess: true,
    })
    expect(relationID(updatedCandidate.targetVersion)).toBe(version.id)
  })

  it('queues accepted or merged candidates for review only when recollection changes', async () => {
    const marker = randomUUID()
    const body: Doc = {
      candidate: {
        id: `review-signal-${marker}`,
        images: [],
        match_state: 'matched',
        proposed_manufacturer_status: 'active',
        raw_character_names: ['林'],
        raw_snapshot: { revision: 1 },
        raw_title: 'Stable candidate title',
        source: {
          source_item_id: `REVIEW-${marker}`,
          source_status: 'active',
          source_type: 'synthetic_feed',
          source_url: `https://synthetic.invalid/review-signal/${marker}`,
        },
      },
      operation: 'candidate_upsert',
      protocol_version: 1,
    }
    const created = await candidateUpsertEndpoint.handler(await jsonRequest(candidateUser, body))
    const createdBody = (await created.clone().json()) as Doc
    expect(created.status).toBe(201)
    const prototype = fixtureDoc(maps.prototypes, 'prototype-orbit-lin-aurora')
    const version = fixtureDoc(maps.versions, 'version-p1-standard')
    const attached = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'attach-version',
        candidateID: createdBody.candidate_id,
        prototypeID: prototype.id,
        reason: 'Prepare recollection review signal test',
        versionID: version.id,
      }),
    )
    expect(attached.status).toBe(200)

    const unchanged = await candidateUpsertEndpoint.handler(await jsonRequest(candidateUser, body))
    expect(unchanged.status).toBe(200)
    expect(((await unchanged.clone().json()) as Doc).outcome).toBe('unchanged')
    const unchangedCandidate = await payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: createdBody.candidate_id,
      overrideAccess: true,
    })
    expect(unchangedCandidate.status).toBe('merged')

    const changedBody = structuredClone(body)
    changedBody.candidate.raw_title = 'Changed candidate title'
    changedBody.candidate.raw_snapshot = { revision: 2 }
    const changed = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, changedBody),
    )
    expect(changed.status).toBe(200)
    expect(((await changed.clone().json()) as Doc).outcome).toBe('updated')
    const queued = await payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: createdBody.candidate_id,
      overrideAccess: true,
    })
    expect(queued.status).toBe('update_pending')
  })

  it('creates a new manufacturer only as audited draft before controlled activation', async () => {
    const name = `Reviewed manufacturer ${randomUUID()}`
    const genericReq = await createLocalReq({ user: admin as any }, payload)
    await expect(
      payload.create({
        collection: 'manufacturers',
        data: { canonicalName: name, status: 'active' },
        overrideAccess: false,
        req: genericReq,
      }),
    ).rejects.toThrow()

    const createdResponse = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'create-manufacturer',
        newManufacturerName: name,
        reason: 'Create unverified manufacturer as draft',
      }),
    )
    expect(createdResponse.status, await createdResponse.clone().text()).toBe(200)
    const draft = ((await createdResponse.clone().json()) as Doc).result
    expect(draft.status).toBe('draft')
    const publicReq = await createLocalReq({}, payload)
    const hiddenDraft = await payload.find({
      collection: 'manufacturers',
      overrideAccess: false,
      req: publicReq,
      where: { id: { equals: draft.id } },
    })
    expect(hiddenDraft.totalDocs).toBe(0)

    const activatedResponse = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'set-manufacturer-status',
        manufacturerID: draft.id,
        manufacturerStatus: 'active',
        reason: 'Synthetic manufacturer verification completed',
      }),
    )
    expect(activatedResponse.status, await activatedResponse.clone().text()).toBe(200)
    const visibleActive = await payload.find({
      collection: 'manufacturers',
      overrideAccess: false,
      req: publicReq,
      where: { id: { equals: draft.id } },
    })
    expect(visibleActive.totalDocs).toBe(1)

    const logs = await payload.find({
      collection: 'operation-logs',
      overrideAccess: true,
      where: {
        and: [
          { 'relatedRecords.manufacturerID': { equals: draft.id } },
          { operationType: { in: ['create_manufacturer', 'set_manufacturer_status'] } },
        ],
      },
    })
    expect(new Set(logs.docs.map((doc) => doc.operationType))).toEqual(
      new Set(['create_manufacturer', 'set_manufacturer_status']),
    )
    expect(logs.docs.every((doc) => Boolean(doc.reason))).toBe(true)
  })

  it('keeps defer/reject/create review writes atomic and auditable', async () => {
    const candidate = fixtureDoc(maps.candidates, 'candidate-new-unmatched')
    const failedReq = await jsonRequest(admin, {
      action: 'defer',
      candidateID: candidate.id,
      reason: 'Injected audit rollback',
    })
    failedReq.context = { ...failedReq.context, testFailBeforeReviewOperationLog: true }
    const failed = await candidateReviewEndpoint.handler(failedReq)
    expect(failed.status).toBe(400)
    const rolledBack = await payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: candidate.id,
      overrideAccess: true,
    })
    expect(rolledBack.status).toBe('pending')

    const deferred = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'defer',
        candidateID: candidate.id,
        reason: 'Wait for synthetic review',
      }),
    )
    expect(deferred.status).toBe(200)
    const deferredRecord = await payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: candidate.id,
      overrideAccess: true,
    })
    expect(deferredRecord.status).toBe('deferred')
    expect(deferredRecord.reason).toBe('Wait for synthetic review')
    const ignored = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'ignore',
        candidateID: candidate.id,
        reason: 'Synthetic duplicate',
      }),
    )
    expect(ignored.status).toBe(200)
    const ignoredRecord = await payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: candidate.id,
      overrideAccess: true,
    })
    expect(ignoredRecord.status).toBe('ignored')
    expect(ignoredRecord.reason).toBe('Synthetic duplicate')
    const rejected = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'reject-field',
        candidateID: candidate.id,
        field: 'rawDate',
        reason: 'Unverified date',
        value: '2026-09',
      }),
    )
    expect(rejected.status).toBe(200)

    const created = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'create-prototype',
        candidateID: candidate.id,
        newPrototype: {
          characters: [fixtureDoc(maps.characters, 'character-aya').id],
          figureType: 'scale',
          manufacturer: fixtureDoc(maps.manufacturers, 'manufacturer-aurora').id,
          title: 'Synthetic reviewed prototype',
        },
        reason: 'Create draft from reviewed candidate',
      }),
    )
    expect(created.status, await created.clone().text()).toBe(200)
    const reviewed = await payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: candidate.id,
      overrideAccess: true,
    })
    expect(reviewed.status).toBe('accepted')
    expect((reviewed.rejectedFields as Doc).rawDate).toBe('2026-09')
    const createdPrototype = await payload.findByID({
      collection: 'figure-prototypes',
      depth: 0,
      id: relationID(reviewed.targetPrototype) as number,
      overrideAccess: true,
    })
    expect(createdPrototype.publicationStatus).toBe('draft')
    expect(createdPrototype.mainImage).toBeFalsy()

    const candidateMain = fixtureDoc(maps.media, 'candidate-image-001-a')
    const selectedMain = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'select-main-image',
        candidateID: candidate.id,
        mediaID: candidateMain.id,
        prototypeID: createdPrototype.id,
        reason: 'Select local synthetic main before publication',
      }),
    )
    expect(selectedMain.status, await selectedMain.clone().text()).toBe(200)
    const publishedResponse = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'set-prototype-publication',
        prototypeID: createdPrototype.id,
        publicationStatus: 'published',
        reason: 'Publish reviewed synthetic prototype',
      }),
    )
    expect(publishedResponse.status, await publishedResponse.clone().text()).toBe(200)
    const publiclyVisible = await payload.find({
      collection: 'figure-prototypes',
      overrideAccess: false,
      where: { id: { equals: createdPrototype.id } },
    })
    expect(publiclyVisible.totalDocs).toBe(1)
    const logs = await payload.find({
      collection: 'operation-logs',
      overrideAccess: true,
      where: {
        operationType: {
          in: [
            'defer_candidate',
            'ignore_candidate',
            'reject_field',
            'create_prototype',
            'select_main_image',
            'set_prototype_publication',
          ],
        },
      },
    })
    expect(new Set(logs.docs.map((doc) => doc.operationType))).toEqual(
      new Set([
        'defer_candidate',
        'ignore_candidate',
        'reject_field',
        'create_prototype',
        'select_main_image',
        'set_prototype_publication',
      ]),
    )
    expect(logs.docs.every((doc) => Boolean(doc.reason))).toBe(true)
  })

  it('keeps exactly one selected main image during an administrator change', async () => {
    const prototype = fixtureDoc(maps.prototypes, 'prototype-orbit-lin-aurora')
    const oldMain = fixtureDoc(maps.media, 'media-prototype-01-main')
    const newMain = fixtureDoc(maps.media, 'candidate-image-002-b')
    const response = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'select-main-image',
        candidateID: fixtureDoc(maps.candidates, 'candidate-main-image-attack').id,
        mediaID: newMain.id,
        prototypeID: prototype.id,
        reason: 'Manual main image selection test',
      }),
    )
    expect(response.status).toBe(200)
    const [oldDoc, newDoc, prototypeDoc] = await Promise.all([
      payload.findByID({ collection: 'media', id: oldMain.id, overrideAccess: true }),
      payload.findByID({ collection: 'media', id: newMain.id, overrideAccess: true }),
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: prototype.id,
        overrideAccess: true,
      }),
    ])
    expect(oldDoc.selectedAsMain).toBe(false)
    expect(newDoc.selectedAsMain).toBe(true)
    expect(relationID(prototypeDoc.mainImage)).toBe(newMain.id)

    const wrongCandidateMedia = fixtureDoc(maps.media, 'candidate-image-001-a')
    const invalid = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'select-main-image',
        candidateID: fixtureDoc(maps.candidates, 'candidate-main-image-attack').id,
        mediaID: wrongCandidateMedia.id,
        prototypeID: prototype.id,
        reason: 'Must reject cross-candidate media',
      }),
    )
    expect(invalid.status).toBe(400)

    const candidateDoc = await payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: fixtureDoc(maps.candidates, 'candidate-main-image-attack').id,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'source-records',
      data: { candidateOwner: candidateUser.id },
      id: relationID(candidateDoc.source) as number,
      overrideAccess: true,
    })
    const fixtureCandidate = (fixture.candidate_records as Doc[]).find(
      (row) => row.id === 'candidate-main-image-attack',
    )!
    const recollected = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, {
        candidate: fixtureCandidate,
        operation: 'candidate_upsert',
        protocol_version: 1,
      }),
    )
    expect(recollected.status, await recollected.clone().text()).toBe(200)
    const [promotedMedia, stablePrototype] = await Promise.all([
      payload.findByID({ collection: 'media', depth: 0, id: newMain.id, overrideAccess: true }),
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: prototype.id,
        overrideAccess: true,
      }),
    ])
    expect(promotedMedia.candidateOnly).toBe(false)
    expect(promotedMedia.selectedAsMain).toBe(true)
    expect(relationID(stablePrototype.mainImage)).toBe(newMain.id)
  })

  it('keeps candidate, media, source and version relations closed through merge, split and two undo operations', async () => {
    const retained = fixtureDoc(maps.prototypes, 'prototype-orbit-lin-aurora')
    const merged = fixtureDoc(maps.prototypes, 'prototype-orbit-lin-lattice')
    const movedVersion = fixtureDoc(maps.versions, 'version-p2-standard')
    const movedSource = fixtureDoc(maps.sources, 'source-p2')
    const adminReq = await createLocalReq({ user: admin as any }, payload)
    const marker = randomUUID()
    const candidateResponse = await candidateUpsertEndpoint.handler(
      await jsonRequest(candidateUser, {
        candidate: {
          id: `merge-component-${marker}`,
          images: [
            {
              file_size: 17,
              format: 'PNG',
              height: 2,
              id: `merge-component-image-${marker}`,
              is_adult: false,
              is_source_homepage: true,
              perceptual_hash: '1010101010101010',
              present_in_latest_source: true,
              sha256: 'b'.repeat(64),
              source_url: `https://synthetic.invalid/merge-component/${marker}.png`,
              storage_key: `synthetic/merge-component/${marker}.png`,
              width: 3,
            },
          ],
          match_state: 'matched',
          proposed_manufacturer_status: 'active',
          raw_character_names: ['林'],
          raw_snapshot: { marker },
          raw_title: 'Synthetic merge relation component',
          source: {
            is_stale: false,
            source_item_id: `MERGE-${marker}`,
            source_status: 'active',
            source_type: 'synthetic_feed',
            source_url: `https://synthetic.invalid/merge-component/${marker}`,
          },
        },
        operation: 'candidate_upsert',
        protocol_version: 1,
      }),
    )
    expect(candidateResponse.status, await candidateResponse.clone().text()).toBe(201)
    const candidateID = ((await candidateResponse.clone().json()) as Doc).candidate_id as number
    const candidate = await payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: candidateID,
      overrideAccess: true,
    })
    const candidateSourceID = relationID(candidate.source) as number
    const candidateMediaID = relationID(candidate.images?.[0]) as number
    await Promise.all([
      payload.update({
        collection: 'candidate-records',
        data: {
          status: 'merged',
          targetPrototype: merged.id,
          targetVersion: movedVersion.id,
        },
        id: candidate.id,
        overrideAccess: true,
        req: adminReq,
      }),
      payload.update({
        collection: 'source-records',
        data: { prototype: merged.id },
        id: candidateSourceID,
        overrideAccess: true,
        req: adminReq,
      }),
      payload.update({
        collection: 'media',
        data: { prototype: merged.id },
        id: candidateMediaID,
        overrideAccess: true,
        req: adminReq,
      }),
    ])

    await expect(
      mergePrototypes(
        adminReq,
        {
          mergedPrototypeID: merged.id,
          reason: 'Injected rollback test',
          retainedPrototypeID: retained.id,
        },
        { afterFirstRelationMove: () => Promise.reject(new Error('injected failure')) },
      ),
    ).rejects.toThrow('injected failure')
    const rolledBackVersion = await payload.findByID({
      collection: 'figure-versions',
      depth: 0,
      id: movedVersion.id,
      overrideAccess: true,
    })
    expect(relationID(rolledBackVersion.prototype)).toBe(merged.id)
    const [rolledBackCandidate, rolledBackCandidateSource, rolledBackCandidateMedia] =
      await Promise.all([
        payload.findByID({
          collection: 'candidate-records',
          depth: 0,
          id: candidate.id,
          overrideAccess: true,
        }),
        payload.findByID({
          collection: 'source-records',
          depth: 0,
          id: candidateSourceID,
          overrideAccess: true,
        }),
        payload.findByID({
          collection: 'media',
          depth: 0,
          id: candidateMediaID,
          overrideAccess: true,
        }),
      ])
    expect(relationID(rolledBackCandidate.targetPrototype)).toBe(merged.id)
    expect(relationID(rolledBackCandidateSource.prototype)).toBe(merged.id)
    expect(relationID(rolledBackCandidateMedia.prototype)).toBe(merged.id)

    const mergeLog = await mergePrototypes(adminReq, {
      mergedPrototypeID: merged.id,
      reason: 'Real merge test',
      retainedPrototypeID: retained.id,
    })
    const mergedDoc = await payload.findByID({
      collection: 'figure-prototypes',
      depth: 0,
      id: merged.id,
      overrideAccess: true,
    })
    expect(mergedDoc.publicationStatus).toBe('merged')
    expect(relationID(mergedDoc.mergedInto)).toBe(retained.id)
    const movedAfterMerge = await Promise.all([
      payload.findByID({
        collection: 'candidate-records',
        depth: 0,
        id: candidate.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'source-records',
        depth: 0,
        id: candidateSourceID,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'media',
        depth: 0,
        id: candidateMediaID,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-versions',
        depth: 0,
        id: movedVersion.id,
        overrideAccess: true,
      }),
    ])
    expect(
      movedAfterMerge.map((doc) =>
        relationID((doc as Doc).targetPrototype ?? (doc as Doc).prototype),
      ),
    ).toEqual([retained.id, retained.id, retained.id, retained.id])

    const splitLog = await splitPrototype(adminReq, {
      candidateIDs: [candidate.id],
      mediaIDs: [candidateMediaID],
      newPrototype: {
        characters: [fixtureDoc(maps.characters, 'character-lin-orbit').id],
        figureType: 'scale',
        manufacturer: fixtureDoc(maps.manufacturers, 'manufacturer-lattice').id,
        title: 'Synthetic split target',
      },
      originPrototypeID: retained.id,
      reason: 'Real split test',
      sourceIDs: [movedSource.id, candidateSourceID],
      versionIDs: [movedVersion.id],
    })
    const splitID = (splitLog.afterState as Doc).newPrototypeID
    const movedAfterSplit = await Promise.all([
      payload.findByID({
        collection: 'candidate-records',
        depth: 0,
        id: candidate.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'source-records',
        depth: 0,
        id: candidateSourceID,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'media',
        depth: 0,
        id: candidateMediaID,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-versions',
        depth: 0,
        id: movedVersion.id,
        overrideAccess: true,
      }),
    ])
    expect(
      movedAfterSplit.map((doc) =>
        relationID((doc as Doc).targetPrototype ?? (doc as Doc).prototype),
      ),
    ).toEqual([splitID, splitID, splitID, splitID])

    const undoSplitLog = await undoLastMergeOrSplit(adminReq, 'Undo real split test')
    const restoredAfterSplit = await Promise.all([
      payload.findByID({
        collection: 'candidate-records',
        depth: 0,
        id: candidate.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'source-records',
        depth: 0,
        id: candidateSourceID,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'media',
        depth: 0,
        id: candidateMediaID,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-versions',
        depth: 0,
        id: movedVersion.id,
        overrideAccess: true,
      }),
    ])
    expect(
      restoredAfterSplit.map((doc) =>
        relationID((doc as Doc).targetPrototype ?? (doc as Doc).prototype),
      ),
    ).toEqual([retained.id, retained.id, retained.id, retained.id])

    const undoMergeLog = await undoLastMergeOrSplit(adminReq, 'Undo real merge test')
    const [
      mergeRestoredCandidate,
      mergeRestoredCandidateMedia,
      mergeRestoredCandidateSource,
      mergeRestoredVersion,
      mergeRestoredSource,
      mergeRestoredPrototype,
      originalMergeLog,
      originalSplitLog,
    ] = await Promise.all([
      payload.findByID({
        collection: 'candidate-records',
        depth: 0,
        id: candidate.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'media',
        depth: 0,
        id: candidateMediaID,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'source-records',
        depth: 0,
        id: candidateSourceID,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-versions',
        depth: 0,
        id: movedVersion.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'source-records',
        depth: 0,
        id: movedSource.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: merged.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'operation-logs',
        depth: 0,
        id: mergeLog.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'operation-logs',
        depth: 0,
        id: splitLog.id,
        overrideAccess: true,
      }),
    ])
    expect(relationID(mergeRestoredCandidate.targetPrototype)).toBe(merged.id)
    expect(relationID(mergeRestoredCandidateMedia.prototype)).toBe(merged.id)
    expect(relationID(mergeRestoredCandidateSource.prototype)).toBe(merged.id)
    expect(relationID(mergeRestoredVersion.prototype)).toBe(merged.id)
    expect(relationID(mergeRestoredSource.prototype)).toBe(merged.id)
    expect(mergeRestoredPrototype.publicationStatus).toBe('published')
    expect(mergeRestoredPrototype.mergedInto).toBeFalsy()
    expect(originalMergeLog.undone).toBe(true)
    expect(originalSplitLog.undone).toBe(true)
    expect(undoSplitLog.operationType).toBe('undo_split')
    expect(undoSplitLog.reason).toBe('Undo real split test')
    expect(undoMergeLog.operationType).toBe('undo_merge')
    expect(undoMergeLog.reason).toBe('Undo real merge test')
  })

  it('rejects a split request that would leave a candidate linked across prototypes', async () => {
    const retained = fixtureDoc(maps.prototypes, 'prototype-orbit-lin-aurora')
    const candidate = fixtureDoc(maps.candidates, 'candidate-main-image-attack')
    const adminReq = await createLocalReq({ user: admin as any }, payload)
    await expect(
      splitPrototype(adminReq, {
        candidateIDs: [candidate.id],
        newPrototype: {
          characters: [fixtureDoc(maps.characters, 'character-lin-orbit').id],
          figureType: 'scale',
          manufacturer: fixtureDoc(maps.manufacturers, 'manufacturer-aurora').id,
          title: 'Rejected incomplete split',
        },
        originPrototypeID: retained.id,
        reason: 'Must include linked target version',
      }),
    ).rejects.toThrow('requires figure-versions')
  })

  it('executes alias routing, Work disambiguation, formal queries and one-entry variants', async () => {
    const aliasMatches = await searchCharacters('Pilot Lin')
    const aliasResolution = resolveCharacterMatches(aliasMatches)
    expect(aliasMatches).toHaveLength(1)
    expect(aliasResolution).toEqual({
      kind: 'unique',
      match: aliasMatches[0],
      target: `/characters/${aliasMatches[0].id}`,
    })
    const sameNameMatches = await searchCharacters('林')
    const sameNameResolution = resolveCharacterMatches(sameNameMatches)
    expect(sameNameResolution.kind).toBe('disambiguation')
    expect(sameNameMatches).toHaveLength(2)
    expect(new Set(sameNameMatches.map((match) => match.workName)).size).toBe(2)
    const groupPrototype = fixtureDoc(maps.prototypes, 'prototype-orbit-duo')
    for (const characterFixtureID of ['character-aya', 'character-lin-orbit']) {
      const group = await payload.find({
        collection: 'figure-prototypes',
        overrideAccess: false,
        where: {
          and: [
            { characters: { contains: fixtureDoc(maps.characters, characterFixtureID).id } },
            { id: { equals: groupPrototype.id } },
          ],
        },
      })
      expect(group.totalDocs).toBe(1)
      expect(group.docs[0]).toMatchObject({ id: groupPrototype.id, isGroup: true })
    }
    const similar = [
      fixtureDoc(maps.prototypes, 'prototype-orbit-lin-aurora'),
      fixtureDoc(maps.prototypes, 'prototype-orbit-lin-lattice'),
    ]
    expect(new Set(similar.map((doc) => doc.id)).size).toBe(2)
    expect(new Set(similar.map((doc) => relationID(doc.manufacturer))).size).toBe(2)
    const similarQuery = await payload.find({
      collection: 'figure-prototypes',
      limit: 10,
      overrideAccess: false,
      where: {
        and: [
          { characters: { contains: fixtureDoc(maps.characters, 'character-lin-orbit').id } },
          { id: { in: similar.map((doc) => doc.id) } },
        ],
      },
    })
    expect(similarQuery.totalDocs).toBe(2)
    expect(new Set(similarQuery.docs.map((doc) => doc.id))).toEqual(
      new Set(similar.map((doc) => doc.id)),
    )
    const variantPrototype = fixtureDoc(maps.prototypes, 'prototype-moon-lin-variants')
    const variants = await payload.find({
      collection: 'figure-versions',
      overrideAccess: true,
      where: { prototype: { equals: variantPrototype.id } },
    })
    expect(variants.totalDocs).toBe(4)
    const variantGallery = await getCharacterGallery(
      fixtureDoc(maps.characters, 'character-lin-moon').id,
      1,
    )
    expect(variantGallery.images.filter((image) => image.id === variantPrototype.id)).toHaveLength(1)

    const staleSource = fixtureDoc(maps.sources, 'source-p5-stale')
    const stalePrototypeSeed = fixtureDoc(maps.prototypes, 'prototype-moon-ren-prize')
    const staleMain = fixtureDoc(maps.media, 'media-prototype-05-main')
    const stalePrototype = await payload.findByID({
      collection: 'figure-prototypes',
      depth: 0,
      id: stalePrototypeSeed.id,
      overrideAccess: true,
    })
    expect(staleSource.invalidated).toBe(true)
    expect(stalePrototype.publicationStatus).toBe('published')
    expect(relationID(stalePrototype.mainImage)).toBe(staleMain.id)
    expect(staleMain.storageKey).toBeTruthy()
    const staleGallery = await getCharacterGallery(
      fixtureDoc(maps.characters, 'character-ren').id,
      1,
    )
    expect(staleGallery.images.some((image) => image.id === stalePrototype.id)).toBe(true)
    const settings = await payload.findGlobal({ overrideAccess: true, slug: 'system-settings' })
    expect(settings.galleryPageSize).toBe(16)
    expect(settings.showAdultImages).toBe(false)
  })

  it('filters an audited adult formal main image by the controlled global setting', async () => {
    const candidate = fixtureDoc(maps.candidates, 'candidate-adult-deferred')
    const adultMedia = fixtureDoc(maps.media, 'candidate-image-003-a')
    const prototype = fixtureDoc(maps.prototypes, 'prototype-moon-lin-variants')
    const character = fixtureDoc(maps.characters, 'character-lin-moon')
    const selected = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'select-main-image',
        candidateID: candidate.id,
        mediaID: adultMedia.id,
        prototypeID: prototype.id,
        reason: 'Promote synthetic adult image for visibility boundary test',
      }),
    )
    expect(selected.status, await selected.clone().text()).toBe(200)

    const defaultGallery = await getCharacterGallery(character.id, 1)
    expect(defaultGallery.images.some((image) => image.id === prototype.id)).toBe(false)

    const enabled = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'update-settings',
        reason: 'Enable adult synthetic images for AC-19',
        settings: { showAdultImages: true },
      }),
    )
    expect(enabled.status, await enabled.clone().text()).toBe(200)
    const enabledGallery = await getCharacterGallery(character.id, 1)
    expect(enabledGallery.images.some((image) => image.id === prototype.id)).toBe(true)

    const reset = await candidateReviewEndpoint.handler(
      await jsonRequest(admin, {
        action: 'update-settings',
        reason: 'Restore adult images default after AC-19',
        settings: { showAdultImages: false },
      }),
    )
    expect(reset.status, await reset.clone().text()).toBe(200)
    const resetGallery = await getCharacterGallery(character.id, 1)
    expect(resetGallery.images.some((image) => image.id === prototype.id)).toBe(false)
  })

  it('paginates seventeen formal gallery items as stable disjoint 16 and 1 item pages', async () => {
    const marker = randomUUID()
    const work = await payload.create({
      collection: 'works',
      data: { name: `Pagination work ${marker}` },
      draft: false,
      overrideAccess: true,
    })
    const character = await payload.create({
      collection: 'characters',
      data: {
        displayName: `Pagination character ${marker}`,
        softDeleted: false,
        status: 'active',
        work: work.id,
      },
      draft: false,
      overrideAccess: true,
    })
    const manufacturer = fixtureDoc(maps.manufacturers, 'manufacturer-aurora')
    const bytes = await generateSyntheticPNG({ height: 3, rgba: [20, 40, 60, 255], width: 2 })
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const perceptualHash = await calculateAverageHash(bytes)
    const prototypeIDs: number[] = []

    for (let index = 0; index < 17; index += 1) {
      const prototype = await payload.create({
        collection: 'figure-prototypes',
        data: {
          characters: [character.id],
          figureType: 'scale',
          isAdult: false,
          isGroup: false,
          manufacturer: manufacturer.id,
          publicationStatus: 'published',
          softDeleted: false,
          title: `Pagination prototype ${String(index).padStart(2, '0')}`,
          work: work.id,
        },
        draft: false,
        overrideAccess: true,
      })
      const media = await payload.create({
        collection: 'media',
        data: {
          byteSize: bytes.length,
          candidateOnly: false,
          format: 'PNG',
          isAdult: false,
          isSourceHomepage: true,
          perceptualHash,
          pixelHeight: 3,
          pixelWidth: 2,
          presentInLatestSource: true,
          prototype: prototype.id,
          selectedAsMain: true,
          sha256,
          sourceUrl: `https://synthetic.invalid/pagination/${marker}/${index}.png`,
          storageKey: `synthetic/pagination/${marker}/${index}.png`,
        },
        file: {
          data: bytes,
          mimetype: 'image/png',
          name: `pagination-${marker}-${index}.png`,
          size: bytes.length,
        },
        overrideAccess: true,
      })
      await payload.update({
        collection: 'figure-prototypes',
        context: { syntheticSeed: true },
        data: { mainImage: media.id },
        draft: false,
        id: prototype.id,
        overrideAccess: true,
      })
      prototypeIDs.push(prototype.id)
    }

    const pageOne = await getCharacterGallery(character.id, 1)
    const pageTwo = await getCharacterGallery(character.id, 2)
    expect(pageOne.images).toHaveLength(16)
    expect(pageTwo.images).toHaveLength(1)
    expect(pageOne.totalPages).toBe(2)
    expect(pageTwo.totalPages).toBe(2)
    const firstIDs = pageOne.images.map((image) => Number(image.id))
    const secondIDs = pageTwo.images.map((image) => Number(image.id))
    expect(firstIDs.filter((id) => new Set(secondIDs).has(id))).toHaveLength(0)
    expect([...firstIDs, ...secondIDs]).toEqual([...prototypeIDs].sort((a, b) => a - b))
    expect(firstIDs).toEqual([...firstIDs].sort((a, b) => a - b))
  })

  it('records every prototype domain operation with complete append-only audit fields', async () => {
    const expectedTypes = new Set([
      'accept_field',
      'attach_version',
      'candidate_upsert',
      'create_manufacturer',
      'create_prototype',
      'defer_candidate',
      'ignore_candidate',
      'merge',
      'reject_field',
      'set_manufacturer_status',
      'set_prototype_publication',
      'select_main_image',
      'split',
      'undo_merge',
      'undo_split',
      'update_settings',
    ])
    const logs = await payload.find({
      collection: 'operation-logs',
      limit: 0,
      overrideAccess: true,
      where: { fixtureID: { exists: false } },
    })
    const observedTypes = new Set(logs.docs.map((doc) => String(doc.operationType)))
    expect([...expectedTypes].every((type) => observedTypes.has(type))).toBe(true)
    for (const log of logs.docs) {
      expect(log.actorLabel).toBeTruthy()
      expect(log.createdAt).toBeTruthy()
      expect(log.operationType).toBeTruthy()
      expect(String(log.reason).trim()).not.toBe('')
      expect(log.beforeState).toBeTypeOf('object')
      expect(log.afterState).toBeTypeOf('object')
      expect(log.relatedRecords).toBeTypeOf('object')
      expect(log.undone).toBeTypeOf('boolean')
    }
  })

  it('creates real local thumbnails and exports parseable relationship metadata without binaries', async () => {
    const image = await payload.findByID({
      collection: 'media',
      depth: 0,
      id: fixtureDoc(maps.media, 'candidate-image-001-a').id,
      overrideAccess: true,
    })
    expect(image.url).toMatch(/^\/api\/media\/file\//)
    expect((image.sizes as Doc).thumbnail.url).toMatch(/^\/api\/media\/file\//)
    expect((image.sizes as Doc).thumbnail.url).not.toBe(image.url)

    const formalMedia = fixtureDoc(maps.media, 'media-prototype-05-main')
    const formalPrototype = fixtureDoc(maps.prototypes, 'prototype-moon-ren-prize')
    const changedMediaURL = 'https://synthetic.invalid/cdn/moved-media-prototype-05-main.png'
    await payload.update({
      collection: 'media',
      data: { sourceUrl: changedMediaURL },
      id: formalMedia.id,
      overrideAccess: true,
    })
    const [stableMedia, stablePrototype] = await Promise.all([
      payload.findByID({
        collection: 'media',
        depth: 0,
        id: formalMedia.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: formalPrototype.id,
        overrideAccess: true,
      }),
    ])
    expect(stableMedia.id).toBe(formalMedia.id)
    expect(stableMedia.storageKey).toBe(formalMedia.storageKey)
    expect(stableMedia.sourceUrl).toBe(changedMediaURL)
    expect(relationID(stablePrototype.mainImage)).toBe(formalMedia.id)

    const json = await buildJSONExport(payload)
    const serialized = JSON.stringify(json)
    expect(JSON.parse(serialized).schema_version).toBe(1)
    expect(serialized).toContain('storageKey')
    expect(serialized).toContain('sourceUrl')
    expect(serialized).toContain('sha256')
    expect(serialized).not.toContain('data:image')
    expect(serialized).not.toContain('iVBOR')
    const csv = buildCSVExports(json)
    expect(Object.keys(csv).length).toBeGreaterThanOrEqual(9)
    expect(csv['media.csv'].split('\n')[0]).toContain('storageKey')

    const relationshipCandidate = await payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: fixtureDoc(maps.candidates, 'candidate-main-image-attack').id,
      overrideAccess: true,
    })
    const exportedCandidate = json.collections['candidate-records'].find(
      (doc) => doc.id === relationshipCandidate.id,
    )!
    expect(exportedCandidate.source).toBe(relationID(relationshipCandidate.source))
    expect(exportedCandidate.targetPrototype).toBe(relationID(relationshipCandidate.targetPrototype))
    expect(exportedCandidate.targetVersion).toBe(relationID(relationshipCandidate.targetVersion))
    expect(exportedCandidate.images).toEqual((relationshipCandidate.images ?? []).map(relationID))

    const exportedPrototype = json.collections['figure-prototypes'].find(
      (doc) => doc.id === stablePrototype.id,
    )!
    expect(exportedPrototype.mainImage).toBe(relationID(stablePrototype.mainImage))
    expect(exportedPrototype.manufacturer).toBe(relationID(stablePrototype.manufacturer))
    expect(exportedPrototype.characters).toEqual(stablePrototype.characters.map(relationID))

    const exportedMedia = json.collections.media.find((doc) => doc.id === stableMedia.id)!
    expect(exportedMedia.prototype).toBe(relationID(stableMedia.prototype))
    expect(exportedMedia.storageKey).toBe(stableMedia.storageKey)
    expect(exportedMedia.sourceUrl).toBe(changedMediaURL)
    expect(exportedMedia.sha256).toBe(stableMedia.sha256)

    const candidateCSVRow = parseCSV(csv['candidate-records.csv']).find(
      (row) => row.id === String(relationshipCandidate.id),
    )!
    expect(candidateCSVRow.source).toBe(String(exportedCandidate.source))
    expect(candidateCSVRow.targetPrototype).toBe(String(exportedCandidate.targetPrototype))
    expect(candidateCSVRow.targetVersion).toBe(String(exportedCandidate.targetVersion))
    expect(JSON.parse(candidateCSVRow.images)).toEqual(exportedCandidate.images)

    const prototypeCSVRow = parseCSV(csv['figure-prototypes.csv']).find(
      (row) => row.id === String(stablePrototype.id),
    )!
    expect(prototypeCSVRow.mainImage).toBe(String(exportedPrototype.mainImage))
    expect(prototypeCSVRow.manufacturer).toBe(String(exportedPrototype.manufacturer))
    expect(JSON.parse(prototypeCSVRow.characters)).toEqual(exportedPrototype.characters)

    const mediaCSVRow = parseCSV(csv['media.csv']).find(
      (row) => row.id === String(stableMedia.id),
    )!
    expect(mediaCSVRow.prototype).toBe(String(exportedMedia.prototype))
    expect(mediaCSVRow.storageKey).toBe(String(exportedMedia.storageKey))
    expect(mediaCSVRow.sourceUrl).toBe(changedMediaURL)
    expect(mediaCSVRow.sha256).toBe(String(exportedMedia.sha256))

    // The generated files exist only in the test TEMP media directory.
    const originalFilename = String(image.filename)
    await expect(readFile(path.join(mediaDir, originalFilename))).resolves.toBeInstanceOf(Buffer)
  })
})
