import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import sharp from 'sharp'

import { openReviewWorkItem } from '@/domain/val02bDomainService'
import { candidateReviewEndpoint } from '@/endpoints/candidateReview'
import { getCharacterGallery, searchCharacters } from '@/lib/gallery'

type Doc = Record<string, any>

type GateState = {
  adminUserID: number
  jpeg: { candidateID: number }
  objectRecovery?: { phase: string; snapshotID: string }
  png: { candidateID: number; mediaID: number; sourceID: number }
  target: { prototypeID: number }
}

const required = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the restored joint gate.`)
  return value
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const outputArg = process.argv.find((argument) => argument.startsWith('--out='))?.slice('--out='.length)
const loginArg = process.argv.find((argument) => argument.startsWith('--login='))?.slice('--login='.length)
if (!outputArg || !loginArg) {
  throw new Error('--out=<runner-temp-json> and --login=<runner-temp-json> are required.')
}

const runnerTemp = path.resolve(required('RUNNER_TEMP'))
const outputPath = path.resolve(outputArg)
const loginPath = path.resolve(loginArg)
for (const [label, candidate] of [['output', outputPath], ['login', loginPath]] as const) {
  assert(candidate.startsWith(`${runnerTemp}${path.sep}`), `${label} path must remain below RUNNER_TEMP.`)
}

assert(process.env.PAYLOAD_CI_PRODUCTION_GATE === 'true', 'The restored joint gate is CI-only.')
assert(process.env.DATABASE_ADAPTER === 'postgres', 'The restored joint gate requires PostgreSQL.')
assert(process.env.S3_ENABLED === 'true', 'The restored joint gate requires S3.')
const snapshotID = required('PAYLOAD_CI_SNAPSHOT_ID')

const relationID = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  if (value && typeof value === 'object' && 'id' in value) {
    return relationID((value as { id: unknown }).id)
  }
  return undefined
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

const safeJoin = (...segments: Array<null | string | undefined>): string =>
  path.posix.join(
    ...segments
      .map((segment) => segment?.trim().replace(/^\/+|\/+$/g, '') ?? '')
      .filter(Boolean),
  )

const businessPrefix = (): string => {
  const prefix = safeJoin(required('S3_PREFIX'))
  assert(prefix && !prefix.startsWith('/') && !prefix.split('/').includes('..'), 'S3_PREFIX is unsafe.')
  return prefix
}

const objectKey = (media: Doc, filename: string): string =>
  safeJoin(businessPrefix(), String(media.prefix ?? ''), filename)

const s3Client = (): S3Client => {
  const endpoint = new URL(required('S3_ENDPOINT'))
  assert(
    endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname),
    'The restored joint gate requires a loopback S3 endpoint.',
  )
  return new S3Client({
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    endpoint: endpoint.toString(),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    region: required('S3_REGION'),
  })
}

const getObjectBytes = async (client: S3Client, key: string): Promise<Buffer> => {
  const result = await client.send(new GetObjectCommand({ Bucket: required('S3_BUCKET'), Key: key }))
  assert(result.Body, `Object ${key} had no body.`)
  return Buffer.from(await (result.Body as any).transformToByteArray())
}

const listObjects = async (client: S3Client): Promise<string[]> => {
  const keys: string[] = []
  let continuationToken: string | undefined
  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: required('S3_BUCKET'),
      ContinuationToken: continuationToken,
      Prefix: `${businessPrefix()}/`,
    }))
    for (const item of response.Contents ?? []) {
      if (item.Key) keys.push(item.Key)
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    assert(!response.IsTruncated || continuationToken, 'Truncated S3 listing omitted a continuation token.')
  } while (continuationToken)
  return keys.sort()
}

const expectedObjects = async (payload: Payload): Promise<string[]> => {
  const result = await (payload as any).find({
    collection: 'media',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    trash: true,
  })
  const keys = new Set<string>()
  for (const media of result.docs as Doc[]) {
    if (media.filename) keys.add(objectKey(media, String(media.filename)))
    for (const size of Object.values(media.sizes ?? {}) as Doc[]) {
      if (size?.filename) keys.add(objectKey(media, String(size.filename)))
    }
  }
  return [...keys].sort()
}

const objectAudit = async (payload: Payload, client: S3Client) => {
  const expected = await expectedObjects(payload)
  const actual = await listObjects(client)
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  return {
    actual_count: actual.length,
    expected_count: expected.length,
    missing: expected.filter((key) => !actualSet.has(key)),
    orphaned: actual.filter((key) => !expectedSet.has(key)),
  }
}

const findFixture = async (payload: Payload, collection: string, fixtureID: string): Promise<Doc> => {
  const result = await (payload as any).find({
    collection,
    depth: 0,
    limit: 2,
    overrideAccess: true,
    trash: true,
    where: { fixtureID: { equals: fixtureID } },
  })
  assert(result.docs.length === 1, `Expected exactly one ${collection} fixture ${fixtureID}.`)
  return result.docs[0]
}

const jsonRequest = async (
  payload: Payload,
  user: Doc,
  body: Record<string, unknown>,
): Promise<PayloadRequest> => {
  const request = await createLocalReq({ user: user as never }, payload)
  Object.defineProperty(request, 'json', {
    configurable: true,
    value: async () => structuredClone(body),
  })
  return request
}

const main = async (): Promise<void> => {
  const state = JSON.parse(await readFile(required('PAYLOAD_CI_GATE_STATE'), 'utf8')) as GateState
  assert(state.objectRecovery?.phase === 'restored', 'Object recovery state is not restored.')
  assert(state.objectRecovery.snapshotID === snapshotID, 'Object recovery snapshot ID differs from the joint gate.')

  const { default: config } = await import('@payload-config')
  const payload = await getPayload({ config })
  const client = s3Client()
  try {
    const settings = await payload.findGlobal({ slug: 'system-settings', overrideAccess: true }) as Doc
    assert(settings.publicReadEnabled === true, 'Public read was not restored.')
    assert(settings.showAdultImages === false, 'Adult images were not hidden after restore.')

    const [ren, linMoon, stalePrototype, adultPrototype, staleSource] = await Promise.all([
      findFixture(payload, 'characters', 'character-ren'),
      findFixture(payload, 'characters', 'character-lin-moon'),
      findFixture(payload, 'figure-prototypes', 'prototype-moon-ren-prize'),
      findFixture(payload, 'figure-prototypes', 'prototype-moon-lin-variants'),
      findFixture(payload, 'source-records', 'source-p5-stale'),
    ])
    const staleMainID = relationID(stalePrototype.mainImage)
    const adultMainID = relationID(adultPrototype.mainImage)
    assert(staleMainID && adultMainID, 'Restored formal prototypes lost their main images.')
    const [staleMain, adultMain] = await Promise.all([
      payload.findByID({ collection: 'media', depth: 0, id: staleMainID, overrideAccess: true }) as Promise<Doc>,
      payload.findByID({ collection: 'media', depth: 0, id: adultMainID, overrideAccess: true }) as Promise<Doc>,
    ])
    assert(staleSource.invalidated === true && staleSource.status === 'missing', 'Invalidated source state was not restored.')
    assert(adultMain.isAdult === true, 'The restored adult visibility fixture is no longer adult.')
    assert(staleMain.filename && adultMain.filename, 'Restored formal media omitted object filenames.')
    assert(staleMain.storageKey && !String(staleMain.storageKey).includes('://'), 'Restored storageKey depends on a URL.')

    const [renSearch, ambiguousSearch, staleGallery, adultGallery] = await Promise.all([
      searchCharacters(String(ren.displayName)),
      searchCharacters('林'),
      getCharacterGallery(ren.id, 1),
      getCharacterGallery(linMoon.id, 1),
    ])
    assert(renSearch.length === 1 && renSearch[0].id === ren.id, 'Unique restored character search failed.')
    assert(ambiguousSearch.length >= 2, 'Restored same-name search no longer disambiguates.')
    assert(staleGallery.images.some((image) => image.id === stalePrototype.id), 'Invalidated-source formal image disappeared from the restored gallery.')
    assert(!adultGallery.images.some((image) => image.id === adultPrototype.id), 'Adult image was exposed by default after restore.')

    const formalMedia = await payload.findByID({
      collection: 'media',
      depth: 0,
      id: state.png.mediaID,
      overrideAccess: true,
    }) as Doc
    const target = await payload.findByID({
      collection: 'figure-prototypes',
      depth: 0,
      id: state.target.prototypeID,
      overrideAccess: true,
    }) as Doc
    assert(relationID(target.mainImage) === formalMedia.id, 'Joint restore changed the reviewed formal main image.')
    assert(formalMedia.candidateOnly === false && formalMedia.selectedAsMain === true, 'Joint restore demoted the formal main image.')
    assert(formalMedia.filename && formalMedia.sizes?.thumbnail?.filename && formalMedia.sizes?.preview?.filename, 'Joint restore lost original/derivative metadata.')
    const originalKey = objectKey(formalMedia, String(formalMedia.filename))
    const thumbnailKey = objectKey(formalMedia, String(formalMedia.sizes.thumbnail.filename))
    const previewKey = objectKey(formalMedia, String(formalMedia.sizes.preview.filename))
    const originalBytes = await getObjectBytes(client, originalKey)
    const thumbnailBefore = await getObjectBytes(client, thumbnailKey)
    const previewBefore = await getObjectBytes(client, previewKey)
    assert(sha256(originalBytes) === formalMedia.sha256, 'Restored formal original SHA-256 differs from the database.')

    await client.send(new DeleteObjectCommand({ Bucket: required('S3_BUCKET'), Key: thumbnailKey }))
    const missingAudit = await objectAudit(payload, client)
    assert(missingAudit.missing.includes(thumbnailKey), 'Object audit did not report a deleted restored derivative.')
    const rebuiltThumbnail = await sharp(originalBytes)
      .rotate()
      .resize({ fastShrinkOnLoad: false, width: 320, withoutEnlargement: true })
      .toBuffer()
    assert(sha256(rebuiltThumbnail) === sha256(thumbnailBefore), 'Restored derivative rebuild changed thumbnail bytes.')
    await client.send(new PutObjectCommand({
      Body: rebuiltThumbnail,
      Bucket: required('S3_BUCKET'),
      ContentType: String(formalMedia.sizes.thumbnail.mimeType ?? formalMedia.mimeType),
      Key: thumbnailKey,
    }))
    assert(
      sha256(await getObjectBytes(client, thumbnailKey)) === sha256(thumbnailBefore),
      'Restored thumbnail bytes changed after rebuild storage.',
    )

    await client.send(new DeleteObjectCommand({ Bucket: required('S3_BUCKET'), Key: originalKey }))
    let missingOriginalRefused = false
    try {
      const absentOriginal = await getObjectBytes(client, originalKey)
      await sharp(absentOriginal).resize({ width: 1280, withoutEnlargement: true }).toBuffer()
    } catch {
      missingOriginalRefused = true
    } finally {
      await client.send(new PutObjectCommand({
        Body: originalBytes,
        Bucket: required('S3_BUCKET'),
        ContentType: String(formalMedia.mimeType),
        Key: originalKey,
      }))
    }
    assert(missingOriginalRefused, 'The restored gate falsely rebuilt a derivative without an original.')
    assert(
      sha256(await getObjectBytes(client, originalKey)) === sha256(originalBytes),
      'Original-loss probe did not restore the formal original exactly.',
    )
    assert(sha256(await getObjectBytes(client, previewKey)) === sha256(previewBefore), 'Original-loss probe changed the preview.')

    const orphanKey = safeJoin(businessPrefix(), 'restored-joint-orphan-probe', `${randomUUID()}.txt`)
    await client.send(new PutObjectCommand({
      Body: Buffer.from('synthetic restored orphan probe\n', 'utf8'),
      Bucket: required('S3_BUCKET'),
      ContentType: 'text/plain',
      Key: orphanKey,
    }))
    const orphanAudit = await objectAudit(payload, client)
    assert(orphanAudit.orphaned.includes(orphanKey), 'Object audit did not report the restored orphan probe.')
    await client.send(new DeleteObjectCommand({ Bucket: required('S3_BUCKET'), Key: orphanKey }))
    const finalAudit = await objectAudit(payload, client)
    assert(finalAudit.missing.length === 0 && finalAudit.orphaned.length === 0, 'Joint restore final object audit is not clean.')

    const admin = await payload.findByID({
      collection: 'users',
      depth: 0,
      id: state.adminUserID,
      overrideAccess: true,
      showHiddenFields: true,
    }) as Doc
    const adminRequest = await createLocalReq({ user: admin as never }, payload)
    const reviewReason = `Restored joint gate audit ${snapshotID} ${randomUUID()}`
    const review = await openReviewWorkItem(adminRequest, {
      allowedTargetIDs: [state.target.prototypeID],
      candidateID: state.jpeg.candidateID,
      reason: 'Restored joint gate opens a bounded review item',
    }) as Doc
    const reviewResponse = await candidateReviewEndpoint.handler(
      await jsonRequest(payload, admin, {
        action: 'reject-field',
        candidateID: state.jpeg.candidateID,
        expectedVersion: Number(review.lockVersion),
        field: 'restored_joint_probe',
        reason: reviewReason,
        value: 'rejected synthetic value',
        workItemID: Number(review.id),
      }),
    )
    assert(reviewResponse.status === 200, `Restored candidate review returned HTTP ${reviewResponse.status}.`)
    const advancedReview = await payload.findByID({
      collection: 'review-work-items',
      depth: 0,
      id: review.id,
      overrideAccess: true,
    }) as Doc
    assert(Number(advancedReview.lockVersion) === Number(review.lockVersion) + 1, 'Restored review did not advance the optimistic lock.')
    const reviewLogs = await payload.find({
      collection: 'operation-logs',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: { reason: { equals: reviewReason } },
    })
    assert(reviewLogs.totalDocs === 1, 'Restored candidate review did not write exactly one audit record.')

    const loginPassword = randomBytes(36).toString('base64url')
    const loginEmail = `restored-joint-${randomUUID()}@synthetic.invalid`
    await (payload as any).create({
      collection: 'users',
      data: { email: loginEmail, password: loginPassword, role: 'admin' },
      overrideAccess: true,
      showHiddenFields: true,
    })
    console.log(`::add-mask::${loginPassword}`)
    await mkdir(path.dirname(loginPath), { recursive: true })
    await writeFile(loginPath, `${JSON.stringify({ email: loginEmail, password: loginPassword })}\n`, 'utf8')
    await chmod(loginPath, 0o600)

    const result = {
      adult: {
        character_id: Number(linMoon.id),
        hidden_by_default: true,
        main_filename: String(adultMain.filename),
        prototype_id: Number(adultPrototype.id),
      },
      candidate_review: {
        audit_record_count: reviewLogs.totalDocs,
        lock_version_advanced: true,
        work_item_id: Number(review.id),
      },
      formal_main: {
        media_id: Number(formalMedia.id),
        original_key: originalKey,
        original_sha256: sha256(originalBytes),
        preview_key: previewKey,
        preview_sha256: sha256(previewBefore),
        storage_key: String(formalMedia.storageKey),
        thumbnail_key: thumbnailKey,
        thumbnail_sha256: sha256(rebuiltThumbnail),
      },
      gallery: {
        ambiguous_match_count: ambiguousSearch.length,
        character_id: Number(ren.id),
        main_filename: String(staleMain.filename),
        prototype_id: Number(stalePrototype.id),
        unique_match_count: renSearch.length,
      },
      object_checks: {
        derivative_missing_detected: true,
        derivative_rebuilt: true,
        final_audit: finalAudit,
        missing_original_rebuild_refused: true,
        orphan_detected: true,
      },
      snapshot_id: snapshotID,
      source: {
        invalidated: true,
        source_id: Number(staleSource.id),
        status: String(staleSource.status),
      },
    }
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ snapshot_id: snapshotID, status: 'pass' }))
  } finally {
    client.destroy()
    await payload.destroy()
  }
}

await main()
process.exit(0)
