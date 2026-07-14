import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import sharp from 'sharp'

import { loadDomainFixture } from '@/domain/fixture'
import { calculateAverageHash, seedPayload } from '@/domain/seed'
import {
  maintainFormalRecord,
  openReviewWorkItem,
} from '@/domain/val02bDomainService'
import { candidateMediaUploadEndpoint } from '@/endpoints/candidateMediaUpload'
import { candidateReviewEndpoint } from '@/endpoints/candidateReview'
import { candidateUpsertEndpoint } from '@/endpoints/candidateUpsert'
import { assertNoHpoiURL } from '@/security/networkGuard'

type Doc = Record<string, any>
type ImageKind = 'jpeg' | 'png'
type Mode =
  | 'audit'
  | 'backup-manifest'
  | 'lifecycle'
  | 'migrate-prefix'
  | 'outage'
  | 'purge'
  | 'recover'
  | 'restore'
  | 'setup'

type Generator = {
  height: number
  kind: ImageKind
  quality?: number
  rgba: [number, number, number, number]
  width: number
}

type CandidateState = {
  candidateID: number
  externalKey: string
  sourceID: number
}

type MediaState = CandidateState & {
  generator: Generator
  idempotencyKey: string
  mediaID: number
  perceptualHash: string
  sha256: string
}

type ObjectManifestEntry = {
  backupETag: string
  backupKey: string
  byteSize: number
  contentType: string
  sha256: string
  sourceETag: string
  sourceKey: string
}

type ObjectRecoveryState = {
  backupCleaned: boolean
  backupPrefix: string
  entries: ObjectManifestEntry[]
  manifestSHA256: string
  phase: 'backed-up' | 'purged' | 'purging' | 'restored' | 'restoring'
  snapshotID: string
}

type RawObjectDescription = {
  byteSize: number
  contentType: string
  etag: string
  sha256: string
}

type FormalReadErrorClass =
  | 'connection_refused'
  | 'connection_reset'
  | 'network_unavailable'
  | 'request_timeout'
  | 'service_unavailable'

type FormalMainImage = {
  key: string
  mediaID: number
  sha256: string
}

type StorageKeyMapping = {
  sourceKey: string
  storageKey: string
}

type GateState = {
  adminUserID: number
  clientID: string
  clientUserID: number
  jpeg: MediaState
  marker: string
  objectRecovery?: ObjectRecoveryState
  outage: CandidateState & {
    attempted: boolean
    formalRead?: {
      mediaID: number
      sha256: string
    }
    generator: Generator
    idempotencyKey: string
    mediaID?: number
    perceptualHash: string
    sha256: string
  }
  png: MediaState
  prefixMigration?: {
    completed: boolean
    mappingCount: number
    mappingSHA256: string
    migrationPrefix: string
  }
  schemaVersion: 1
  sharedSyntheticSourceURL: string
  target: {
    initialMainImageID: number
    prototypeID: number
    versionID: number
  }
}

const MAX_TEST_IMAGE_BYTES = 64 * 1024
const allowedModes = new Set<Mode>([
  'audit',
  'backup-manifest',
  'lifecycle',
  'migrate-prefix',
  'outage',
  'purge',
  'recover',
  'restore',
  'setup',
])

const required = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} must be supplied at runtime.`)
  return value
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const relationID = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  if (value && typeof value === 'object' && 'id' in value) {
    return relationID((value as { id: unknown }).id)
  }
  return undefined
}

const sha256 = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex')

const safeJoin = (...segments: Array<null | string | undefined>): string =>
  path.posix.join(
    ...segments
      .map((segment) => segment?.trim().replace(/^\/+|\/+$/g, '') ?? '')
      .filter(Boolean),
  )

const normalizedObjectPrefix = (value: string, label: string): string => {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '')
  assert(trimmed.length > 0, `${label} must not be empty.`)
  assert(!trimmed.includes('\\'), `${label} must use POSIX object-key separators.`)
  assert(!trimmed.includes('://'), `${label} must be a storage prefix, not a URL.`)
  const segments = trimmed.split('/')
  assert(
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
    `${label} contains an unsafe or empty segment.`,
  )
  return segments.join('/')
}

const businessPrefix = (): string =>
  normalizedObjectPrefix(required('S3_PREFIX'), 'S3_PREFIX')

const prefixesOverlap = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)

const temporaryObjectPrefix = (
  kind: 'backup' | 'migration',
  marker: string,
): string => {
  const prefix = normalizedObjectPrefix(
    safeJoin(`ci-payload-prod-gate-${kind}`, marker, sha256(businessPrefix()).slice(0, 16)),
    `${kind} prefix`,
  )
  assert(
    !prefixesOverlap(prefix, businessPrefix()),
    `${kind} prefix must not overlap the business prefix.`,
  )
  return prefix
}

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

const runnerTemp = path.resolve(required('RUNNER_TEMP'))
const statePath = path.resolve(
  process.env.PAYLOAD_CI_GATE_STATE?.trim() ||
    path.join(runnerTemp, 'payload-prod-gate', 'media-state.json'),
)
const resultsDir = path.resolve(
  process.env.PAYLOAD_CI_GATE_RESULTS_DIR?.trim() ||
    path.join(runnerTemp, 'payload-prod-gate-results'),
)

const assertRuntimeGate = (): void => {
  assert(
    process.env.PAYLOAD_CI_PRODUCTION_GATE === 'true',
    'PAYLOAD_CI_PRODUCTION_GATE=true is required.',
  )
  assert(process.env.DATABASE_ADAPTER === 'postgres', 'DATABASE_ADAPTER must be postgres.')
  assert(process.env.S3_ENABLED === 'true', 'S3_ENABLED must be true.')
  assert(isWithin(runnerTemp, statePath), 'PAYLOAD_CI_GATE_STATE must be below RUNNER_TEMP.')
  assert(isWithin(runnerTemp, resultsDir), 'PAYLOAD_CI_GATE_RESULTS_DIR must be below RUNNER_TEMP.')

  const database = new URL(required('DATABASE_URI'))
  assert(
    database.hostname === '127.0.0.1' || database.hostname === 'localhost',
    'The production gate database must be loopback-only.',
  )
  const endpoint = assertNoHpoiURL(required('S3_ENDPOINT'), 'S3 endpoint')
  assert(
    endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost',
    'The production gate S3 endpoint must be loopback-only.',
  )
  assert(process.env.S3_FORCE_PATH_STYLE === 'true', 'S3_FORCE_PATH_STYLE must be true for MinIO.')
  businessPrefix()
}

const sensitiveKey = /(?:^|_)(?:authorization|credential|password|secret|access_?key|api_?key)(?:$|_)/i

const assertSanitized = (value: unknown): void => {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!node || typeof node !== 'object') return
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      assert(!sensitiveKey.test(key), `Sensitive field ${key} cannot be written to gate state.`)
      visit(child)
    }
  }
  visit(value)
  const serialized = JSON.stringify(value)
  for (const name of [
    'PAYLOAD_SECRET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]) {
    const secret = process.env[name]
    if (secret && secret.length >= 8) {
      assert(!serialized.includes(secret), `${name} leaked into gate state.`)
    }
  }
}

const validateSnapshotID = (value: string, label: string): string => {
  assert(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value),
    `${label} must contain only 1-128 safe identifier characters.`,
  )
  return value
}

const requiredSnapshotID = (): string => {
  const value = validateSnapshotID(required('PAYLOAD_CI_SNAPSHOT_ID'), 'PAYLOAD_CI_SNAPSHOT_ID')
  assertSanitized({ snapshot_id: value })
  return value
}

const atomicJSON = async (target: string, value: unknown): Promise<void> => {
  assertSanitized(value)
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

const assertNoEvidenceURLs = (value: unknown): void => {
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      assert(!/[a-z][a-z\d+.-]*:\/\//i.test(node), 'Machine evidence must not contain a URL.')
      return
    }
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!node || typeof node !== 'object') return
    Object.values(node as Record<string, unknown>).forEach(visit)
  }
  visit(value)
}

const writeEvidence = async (mode: Mode, details: Record<string, unknown>): Promise<void> => {
  const result = {
    component: 'payload-postgres-minio-media',
    details,
    mode,
    schema_version: 1,
    status: 'pass',
  }
  assertNoEvidenceURLs(result)
  await atomicJSON(path.join(resultsDir, `media-${mode}.json`), result)
  process.stdout.write(`${JSON.stringify({ mode, status: 'pass' })}\n`)
}

const manifestDigest = (entries: ObjectManifestEntry[]): string =>
  sha256(JSON.stringify(entries.map((entry) => ({
    backup_etag: entry.backupETag,
    backup_key: entry.backupKey,
    byte_size: entry.byteSize,
    content_type: entry.contentType,
    sha256: entry.sha256,
    source_etag: entry.sourceETag,
    source_key: entry.sourceKey,
  }))))

const readState = async (): Promise<GateState> => {
  const parsed = JSON.parse(await readFile(statePath, 'utf8')) as GateState
  assert(parsed.schemaVersion === 1, 'Unsupported media gate state schema.')
  if (parsed.objectRecovery) {
    const recovery = parsed.objectRecovery
    validateSnapshotID(recovery.snapshotID, 'Stored object-recovery snapshot ID')
    assert(
      recovery.backupPrefix === temporaryObjectPrefix('backup', parsed.marker),
      'Object recovery backup prefix does not match this gate run.',
    )
    assert(recovery.entries.length > 0, 'Object recovery manifest must not be empty.')
    assert(
      recovery.manifestSHA256 === manifestDigest(recovery.entries),
      'Object recovery manifest digest mismatch.',
    )
    assert(
      new Set(recovery.entries.map((entry) => entry.sourceKey)).size === recovery.entries.length,
      'Object recovery manifest contains duplicate source keys.',
    )
    assert(
      new Set(recovery.entries.map((entry) => entry.backupKey)).size === recovery.entries.length,
      'Object recovery manifest contains duplicate backup keys.',
    )
    assert(
      recovery.entries.every((entry) => entry.backupKey.startsWith(`${recovery.backupPrefix}/`)),
      'Object recovery manifest contains a backup key outside its backup prefix.',
    )
    assert(
      recovery.entries.every((entry) => entry.sourceKey.startsWith(`${businessPrefix()}/`)),
      'Object recovery manifest contains a source key outside the business prefix.',
    )
    assert(
      recovery.entries.every((entry) =>
        entry.byteSize > 0 &&
        /^[a-f\d]{64}$/.test(entry.sha256) &&
        entry.sourceETag.length > 0 &&
        entry.backupETag.length > 0 &&
        !entry.sourceKey.includes('://') &&
        !entry.backupKey.includes('://')),
      'Object recovery manifest contains an invalid entry.',
    )
  }
  return parsed
}

const assertSnapshotMatches = (recovery: ObjectRecoveryState): string => {
  const current = requiredSnapshotID()
  assert(
    recovery.snapshotID === current,
    'PAYLOAD_CI_SNAPSHOT_ID does not match the object-recovery state.',
  )
  return current
}

const writeState = async (state: GateState): Promise<void> => atomicJSON(statePath, state)

const s3Client = (): S3Client =>
  new S3Client({
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    endpoint: required('S3_ENDPOINT'),
    forcePathStyle: true,
    region: required('S3_REGION'),
  })

const generateImage = async (generator: Generator): Promise<Buffer> => {
  const [r, g, b, a] = generator.rgba
  const image = sharp({
    create: {
      background: { alpha: a / 255, b, g, r },
      channels: 4,
      height: generator.height,
      width: generator.width,
    },
  })
  const bytes = generator.kind === 'png'
    ? await image.png().toBuffer()
    : await image.jpeg({ quality: generator.quality ?? 88 }).toBuffer()
  assert(bytes.length <= MAX_TEST_IMAGE_BYTES, 'Synthetic fixture exceeds the upload test limit.')
  return bytes
}

const jsonRequest = async (
  payload: Payload,
  user: Doc,
  body: Record<string, unknown>,
): Promise<PayloadRequest> => {
  const req = await createLocalReq({ user: user as never }, payload)
  Object.defineProperty(req, 'json', {
    configurable: true,
    value: async () => structuredClone(body),
  })
  return req
}

const multipartRequest = async (
  payload: Payload,
  user: Doc,
  metadata: Record<string, unknown>,
  bytes: Buffer,
): Promise<PayloadRequest> => {
  const req = await createLocalReq({ user: user as never }, payload)
  const form = new FormData()
  form.set('metadata', JSON.stringify(metadata))
  form.set(
    'file',
    new File(
      [Uint8Array.from(bytes).buffer],
      String(metadata.filename),
      { type: String(metadata.content_type) },
    ),
  )
  Object.defineProperty(req, 'formData', {
    configurable: true,
    value: async () => form,
  })
  return req
}

const responseJSON = async (response: Response): Promise<Doc> => {
  try {
    return await response.json() as Doc
  } catch {
    return {}
  }
}

const createCandidate = async (
  payload: Payload,
  user: Doc,
  marker: string,
  label: string,
): Promise<CandidateState> => {
  const externalKey = `ci-media-${label}-${marker}`
  const response = await candidateUpsertEndpoint.handler(
    await jsonRequest(payload, user, {
      candidate: {
        id: externalKey,
        images: [],
        raw_character_names: ['Synthetic CI Character'],
        raw_manufacturer: 'Synthetic CI Manufacturer',
        raw_snapshot: { gate: 'payload-production', label, marker },
        raw_title: `Synthetic ${label} candidate`,
        source: {
          source_item_id: `ci-source-${label}-${marker}`,
          source_status: 'active',
          source_type: 'SyntheticCI',
          source_url: `https://synthetic.invalid/ci-media/${marker}/${label}`,
        },
        status: 'pending',
      },
      operation: 'candidate_upsert',
      protocol_version: 1,
    }),
  )
  const body = await responseJSON(response)
  assert(
    response.status === 201,
    `Candidate ${label} setup returned HTTP ${response.status}: ${String(body.error ?? 'unknown error').slice(0, 200)}`,
  )
  return {
    candidateID: Number(body.candidate_id),
    externalKey,
    sourceID: Number(body.source_id),
  }
}

const uploadMetadata = async (
  clientID: string,
  candidate: CandidateState,
  generator: Generator,
  idempotencyKey: string,
  filename: string,
): Promise<{ bytes: Buffer; metadata: Doc; perceptualHash: string; sha256: string }> => {
  const bytes = await generateImage(generator)
  const digest = sha256(bytes)
  const perceptualHash = await calculateAverageHash(bytes)
  return {
    bytes,
    metadata: {
      candidate_id: candidate.candidateID,
      client_candidate_id: candidate.externalKey,
      client_id: clientID,
      content_type: generator.kind === 'png' ? 'image/png' : 'image/jpeg',
      file_size: bytes.length,
      filename,
      height: generator.height,
      idempotency_key: idempotencyKey,
      operation: 'candidate_media_upload',
      perceptual_hash: perceptualHash,
      protocol_version: 2,
      sha256: digest,
      width: generator.width,
    },
    perceptualHash,
    sha256: digest,
  }
}

const upload = async (
  payload: Payload,
  user: Doc,
  metadata: Doc,
  bytes: Buffer,
): Promise<{ body: Doc; status: number }> => {
  const response = await candidateMediaUploadEndpoint.handler(
    await multipartRequest(payload, user, metadata, bytes),
  )
  return { body: await responseJSON(response), status: response.status }
}

const findFixture = async (payload: Payload, collection: string, fixtureID: string): Promise<Doc> => {
  const result = await (payload as any).find({
    collection,
    depth: 0,
    limit: 2,
    overrideAccess: true,
    where: { fixtureID: { equals: fixtureID } },
  })
  assert(result.docs.length === 1, `Expected one ${collection} fixture ${fixtureID}.`)
  return result.docs[0]
}

const loadUser = async (payload: Payload, id: number): Promise<Doc> =>
  payload.findByID({
    collection: 'users',
    depth: 0,
    id,
    overrideAccess: true,
    showHiddenFields: true,
  }) as Promise<Doc>

const objectKey = (media: Doc, filename: string): string =>
  safeJoin(businessPrefix(), String(media.prefix ?? ''), filename)

const currentFormalMainImage = async (
  payload: Payload,
  prototypeID: number,
): Promise<FormalMainImage> => {
  const prototype = await payload.findByID({
    collection: 'figure-prototypes',
    depth: 0,
    id: prototypeID,
    overrideAccess: true,
  }) as Doc
  const mediaID = relationID(prototype.mainImage)
  assert(mediaID, `Figure prototype ${prototypeID} has no formal main image.`)
  const media = await payload.findByID({
    collection: 'media',
    depth: 0,
    id: mediaID,
    overrideAccess: true,
  }) as Doc
  assert(media.candidateOnly === false, 'The current main image is still candidate-only.')
  assert(media.filename, `Formal main image ${mediaID} has no object filename.`)
  assert(/^[a-f\d]{64}$/.test(String(media.sha256)), `Formal main image ${mediaID} has no valid SHA-256.`)
  return {
    key: objectKey(media, String(media.filename)),
    mediaID,
    sha256: String(media.sha256),
  }
}

const classifyUnavailableError = (error: unknown): FormalReadErrorClass | undefined => {
  const codes = new Set<string>()
  const statuses = new Set<number>()
  const seen = new Set<unknown>()
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return
    seen.add(value)
    const record = value as Record<string, unknown>
    for (const field of ['code', 'Code', 'name']) {
      if (typeof record[field] === 'string') codes.add(record[field].toUpperCase())
    }
    const metadata = record.$metadata
    if (metadata && typeof metadata === 'object') {
      const status = (metadata as Record<string, unknown>).httpStatusCode
      if (typeof status === 'number') statuses.add(status)
    }
    visit(record.cause, depth + 1)
    if (Array.isArray(record.errors)) record.errors.forEach((child) => visit(child, depth + 1))
  }
  visit(error, 0)

  if ([502, 503, 504].some((status) => statuses.has(status))) return 'service_unavailable'
  if (codes.has('ECONNREFUSED')) return 'connection_refused'
  if (codes.has('ECONNRESET') || codes.has('EPIPE')) return 'connection_reset'
  if (
    codes.has('ETIMEDOUT') ||
    codes.has('TIMEOUTERROR') ||
    codes.has('REQUESTTIMEOUT') ||
    codes.has('UND_ERR_CONNECT_TIMEOUT')
  ) return 'request_timeout'
  if (
    codes.has('ENETUNREACH') ||
    codes.has('EHOSTUNREACH') ||
    codes.has('EAI_AGAIN')
  ) return 'network_unavailable'
  if (codes.has('SERVICEUNAVAILABLE') || codes.has('INTERNALERROR')) return 'service_unavailable'
  return undefined
}

const getObjectBytes = async (client: S3Client, key: string): Promise<Buffer> => {
  const result = await client.send(new GetObjectCommand({ Bucket: required('S3_BUCKET'), Key: key }))
  assert(result.Body, `S3 object ${key} has no body.`)
  return Buffer.from(await (result.Body as any).transformToByteArray())
}

const objectExists = async (client: S3Client, key: string): Promise<boolean> => {
  try {
    await client.send(new HeadObjectCommand({ Bucket: required('S3_BUCKET'), Key: key }))
    return true
  } catch (error) {
    const status = (error as any)?.$metadata?.httpStatusCode
    const name = (error as any)?.name
    if (status === 404 || name === 'NoSuchKey' || name === 'NotFound') return false
    throw error
  }
}

const normalizedETag = (value: string | undefined, key: string): string => {
  const normalized = value?.trim().replace(/^"|"$/g, '') ?? ''
  assert(normalized.length > 0, `S3 object ${key} has no ETag.`)
  return normalized
}

const describeRawObject = async (
  client: S3Client,
  key: string,
): Promise<RawObjectDescription> => {
  const head = await client.send(new HeadObjectCommand({
    Bucket: required('S3_BUCKET'),
    Key: key,
  }))
  const bytes = await getObjectBytes(client, key)
  assert(
    head.ContentLength === undefined || head.ContentLength === bytes.length,
    `S3 object ${key} length differs between HEAD and GET.`,
  )
  return {
    byteSize: bytes.length,
    contentType: head.ContentType?.trim() || 'application/octet-stream',
    etag: normalizedETag(head.ETag, key),
    sha256: sha256(bytes),
  }
}

const putVerifiedObject = async (
  client: S3Client,
  key: string,
  bytes: Buffer,
  contentType: string,
  expectedSHA256: string,
): Promise<RawObjectDescription> => {
  assert(sha256(bytes) === expectedSHA256, `Object ${key} input SHA-256 mismatch.`)
  await client.send(new PutObjectCommand({
    Body: bytes,
    Bucket: required('S3_BUCKET'),
    ContentType: contentType,
    Key: key,
  }))
  const stored = await describeRawObject(client, key)
  assert(stored.sha256 === expectedSHA256, `Object ${key} changed during storage.`)
  assert(stored.byteSize === bytes.length, `Object ${key} byte size changed during storage.`)
  return stored
}

const describeObject = async (
  client: S3Client,
  key: string,
): Promise<{ byte_size: number; format: string; height: number; sha256: string; width: number }> => {
  const first = await getObjectBytes(client, key)
  const second = await getObjectBytes(client, key)
  assert(sha256(first) === sha256(second), `Repeated read changed object ${key}.`)
  const metadata = await sharp(first).metadata()
  assert(metadata.width && metadata.height && metadata.format, `Object ${key} is not a decoded image.`)
  return {
    byte_size: first.length,
    format: metadata.format,
    height: metadata.height,
    sha256: sha256(first),
    width: metadata.width,
  }
}

const inspectMedia = async (payload: Payload, client: S3Client, mediaID: number) => {
  const media = await payload.findByID({
    collection: 'media',
    depth: 0,
    id: mediaID,
    overrideAccess: true,
  }) as Doc
  assert(media.filename, `Media ${mediaID} has no original filename.`)
  const prefix = String(media.prefix ?? '')
  const stableKey = safeJoin(prefix, String(media.filename))
  assert(media.storageKey === stableKey, `Media ${mediaID} storageKey diverged from its document key.`)
  assert(!String(media.storageKey).includes('://'), 'storageKey must not contain a URL scheme.')
  for (const value of [media.sourceUrl, media.url, process.env.S3_ENDPOINT]) {
    if (typeof value === 'string' && value) {
      assert(!String(media.storageKey).includes(value), 'storageKey must not contain a public or endpoint URL.')
    }
  }

  const originalKey = objectKey(media, String(media.filename))
  const original = await describeObject(client, originalKey)
  assert(original.sha256 === media.sha256, `Media ${mediaID} original SHA-256 mismatch.`)
  assert(original.width === media.pixelWidth, `Media ${mediaID} original width mismatch.`)
  assert(original.height === media.pixelHeight, `Media ${mediaID} original height mismatch.`)
  const bytes = await getObjectBytes(client, originalKey)
  const storedPerceptualHash = String(media.perceptualHash ?? '')
  assert(
    /^[a-f0-9]{16}$/.test(storedPerceptualHash),
    `Media ${mediaID} aHash must be exactly 16 lowercase hexadecimal characters.`,
  )
  const calculatedPerceptualHash = await calculateAverageHash(bytes)
  assert(
    calculatedPerceptualHash === storedPerceptualHash,
    `Media ${mediaID} aHash mismatch.`,
  )

  const sizes: Record<string, unknown> = {}
  for (const name of ['thumbnail', 'preview'] as const) {
    const size = media.sizes?.[name]
    assert(size?.filename, `Media ${mediaID} is missing ${name} metadata.`)
    const key = objectKey(media, String(size.filename))
    const detail = await describeObject(client, key)
    assert(detail.width === Number(size.width), `Media ${mediaID} ${name} width mismatch.`)
    assert(detail.height === Number(size.height), `Media ${mediaID} ${name} height mismatch.`)
    sizes[name] = { key, ...detail }
  }

  return {
    media,
    summary: {
      original: {
        key: originalKey,
        ...original,
        perceptual_hash: calculatedPerceptualHash,
      },
      sizes,
      storage_key: media.storageKey,
    },
  }
}

const listObjectKeysUnderPrefix = async (
  client: S3Client,
  prefix: string,
): Promise<string[]> => {
  const normalizedPrefix = normalizedObjectPrefix(prefix, 'object listing prefix')
  const keys: string[] = []
  let continuationToken: string | undefined
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: required('S3_BUCKET'),
      ContinuationToken: continuationToken,
      Prefix: `${normalizedPrefix}/`,
    }))
    for (const object of page.Contents ?? []) {
      if (!object.Key) continue
      assert(
        object.Key.startsWith(`${normalizedPrefix}/`),
        `S3 listing escaped the requested prefix ${normalizedPrefix}.`,
      )
      keys.push(object.Key)
    }
    if (page.IsTruncated) {
      assert(page.NextContinuationToken, 'Truncated S3 listing did not return a continuation token.')
      continuationToken = page.NextContinuationToken
    } else {
      continuationToken = undefined
    }
  } while (continuationToken)
  return keys.sort()
}

const listObjectKeys = async (client: S3Client): Promise<string[]> =>
  listObjectKeysUnderPrefix(client, businessPrefix())

const deleteObjectKeys = async (client: S3Client, keys: string[]): Promise<void> => {
  for (const key of [...keys].sort()) {
    await client.send(new DeleteObjectCommand({
      Bucket: required('S3_BUCKET'),
      Key: key,
    }))
  }
}

const deleteObjectPrefix = async (client: S3Client, prefix: string): Promise<number> => {
  const keys = await listObjectKeysUnderPrefix(client, prefix)
  await deleteObjectKeys(client, keys)
  assert(
    (await listObjectKeysUnderPrefix(client, prefix)).length === 0,
    `Object prefix ${prefix} was not fully deleted.`,
  )
  return keys.length
}

const expectedStorageKeyMappings = async (payload: Payload): Promise<StorageKeyMapping[]> => {
  const result = await (payload as any).find({
    collection: 'media',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    trash: true,
  })
  const mappings = new Map<string, StorageKeyMapping>()
  const addMapping = (storageKey: string, sourceKey: string): void => {
    assert(storageKey.length > 0, 'A media storage key must not be empty.')
    assert(!storageKey.includes('://'), 'A media storage key must not contain a URL scheme.')
    assert(!storageKey.startsWith('/'), 'A media storage key must be relative.')
    assert(
      storageKey.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
      'A media storage key contains an unsafe or empty segment.',
    )
    const existing = mappings.get(storageKey)
    assert(
      !existing || existing.sourceKey === sourceKey,
      `Storage key ${storageKey} maps to more than one source object.`,
    )
    mappings.set(storageKey, {
      sourceKey,
      storageKey,
    })
  }
  for (const media of result.docs as Doc[]) {
    if (media.filename) {
      const storageKey = String(media.storageKey ?? '')
      addMapping(storageKey, objectKey(media, String(media.filename)))
      const storageDirectory = path.posix.dirname(storageKey) === '.'
        ? ''
        : path.posix.dirname(storageKey)
      for (const size of Object.values(media.sizes ?? {}) as Doc[]) {
        if (size?.filename) {
          addMapping(
            safeJoin(storageDirectory, String(size.filename)),
            objectKey(media, String(size.filename)),
          )
        }
      }
    }
  }
  return [...mappings.values()].sort((left, right) => left.storageKey.localeCompare(right.storageKey))
}

const expectedObjectKeys = async (payload: Payload): Promise<string[]> => {
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
  const expected = await expectedObjectKeys(payload)
  const actual = await listObjectKeys(client)
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  return {
    actual_count: actual.length,
    expected_count: expected.length,
    missing: expected.filter((key) => !actualSet.has(key)),
    orphaned: actual.filter((key) => !expectedSet.has(key)),
  }
}

const assertExactKeys = (
  actual: string[],
  expected: string[],
  label: string,
): void => {
  const normalizedActual = [...actual].sort()
  const normalizedExpected = [...expected].sort()
  assert(
    JSON.stringify(normalizedActual) === JSON.stringify(normalizedExpected),
    `${label} object-key set differs from its manifest.`,
  )
}

const assertRawObject = (
  actual: RawObjectDescription,
  expected: Pick<ObjectManifestEntry, 'byteSize' | 'sha256'>,
  label: string,
): void => {
  assert(actual.byteSize === expected.byteSize, `${label} byte-size mismatch.`)
  assert(actual.sha256 === expected.sha256, `${label} SHA-256 mismatch.`)
}

const manifestEvidenceEntries = (entries: ObjectManifestEntry[]) =>
  entries.map((entry) => ({
    backup_etag: entry.backupETag,
    backup_key: entry.backupKey,
    byte_size: entry.byteSize,
    content_type: entry.contentType,
    sha256: entry.sha256,
    source_etag: entry.sourceETag,
    source_key: entry.sourceKey,
  }))

const verifyBackupManifest = async (
  client: S3Client,
  recovery: ObjectRecoveryState,
): Promise<void> => {
  assert(!recovery.backupCleaned, 'Backup objects were already cleaned.')
  assertExactKeys(
    await listObjectKeysUnderPrefix(client, recovery.backupPrefix),
    recovery.entries.map((entry) => entry.backupKey),
    'Backup',
  )
  for (const entry of recovery.entries) {
    const actual = await describeRawObject(client, entry.backupKey)
    assertRawObject(actual, entry, `Backup object ${entry.backupKey}`)
    assert(actual.etag === entry.backupETag, `Backup object ${entry.backupKey} ETag mismatch.`)
  }
}

const verifySourceManifest = async (
  client: S3Client,
  entries: ObjectManifestEntry[],
): Promise<void> => {
  assertExactKeys(
    await listObjectKeys(client),
    entries.map((entry) => entry.sourceKey),
    'Business prefix',
  )
  for (const entry of entries) {
    const actual = await describeRawObject(client, entry.sourceKey)
    assertRawObject(actual, entry, `Source object ${entry.sourceKey}`)
  }
}

const backupManifest = async (payload: Payload): Promise<void> => {
  const state = await readState()
  const snapshotID = requiredSnapshotID()
  const client = s3Client()
  try {
    if (state.objectRecovery) {
      assertSnapshotMatches(state.objectRecovery)
      assert(
        state.objectRecovery.phase === 'backed-up' && !state.objectRecovery.backupCleaned,
        'A backup manifest already exists in a later recovery phase.',
      )
      await verifyBackupManifest(client, state.objectRecovery)
      await verifySourceManifest(client, state.objectRecovery.entries)
      await writeEvidence('backup-manifest', {
        backup_prefix: state.objectRecovery.backupPrefix,
        entries: manifestEvidenceEntries(state.objectRecovery.entries),
        manifest_sha256: state.objectRecovery.manifestSHA256,
        object_count: state.objectRecovery.entries.length,
        snapshot_id: snapshotID,
      })
      return
    }

    const audit = await objectAudit(payload, client)
    assert(audit.missing.length === 0, 'Cannot back up a business prefix with missing objects.')
    assert(audit.orphaned.length === 0, 'Cannot back up a business prefix with orphaned objects.')
    const sourceKeys = await listObjectKeys(client)
    assert(sourceKeys.length > 0, 'Cannot create an empty object backup manifest.')

    const backupPrefix = temporaryObjectPrefix('backup', state.marker)
    const staleBackupKeys = await listObjectKeysUnderPrefix(client, backupPrefix)
    if (staleBackupKeys.length > 0) {
      await deleteObjectKeys(client, staleBackupKeys)
      assert(
        (await listObjectKeysUnderPrefix(client, backupPrefix)).length === 0,
        'A stale temporary backup prefix could not be cleaned.',
      )
    }

    const entries: ObjectManifestEntry[] = []
    try {
      for (const sourceKey of sourceKeys) {
        const source = await describeRawObject(client, sourceKey)
        const sourceBytes = await getObjectBytes(client, sourceKey)
        assert(sha256(sourceBytes) === source.sha256, `Source object ${sourceKey} changed while backing up.`)
        const relativeKey = sourceKey.slice(`${businessPrefix()}/`.length)
        assert(relativeKey.length > 0, `Source object ${sourceKey} has no relative key.`)
        const backupKey = safeJoin(backupPrefix, relativeKey)
        const backup = await putVerifiedObject(
          client,
          backupKey,
          sourceBytes,
          source.contentType,
          source.sha256,
        )
        entries.push({
          backupETag: backup.etag,
          backupKey,
          byteSize: source.byteSize,
          contentType: source.contentType,
          sha256: source.sha256,
          sourceETag: source.etag,
          sourceKey,
        })
      }
    } catch (error) {
      await deleteObjectPrefix(client, backupPrefix)
      throw error
    }

    entries.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
    const recovery: ObjectRecoveryState = {
      backupCleaned: false,
      backupPrefix,
      entries,
      manifestSHA256: manifestDigest(entries),
      phase: 'backed-up',
      snapshotID,
    }
    await verifyBackupManifest(client, recovery)
    state.objectRecovery = recovery
    await writeState(state)
    await writeEvidence('backup-manifest', {
      backup_prefix: backupPrefix,
      entries: manifestEvidenceEntries(entries),
      manifest_sha256: recovery.manifestSHA256,
      object_count: entries.length,
      snapshot_id: snapshotID,
    })
  } finally {
    client.destroy()
  }
}

const purge = async (): Promise<void> => {
  const state = await readState()
  const recovery = state.objectRecovery
  assert(recovery, 'Purge requires a completed backup manifest.')
  const snapshotID = assertSnapshotMatches(recovery)
  assert(
    recovery.phase === 'backed-up' || recovery.phase === 'purging',
    'Purge requires the backed-up or purging phase.',
  )
  const client = s3Client()
  try {
    await verifyBackupManifest(client, recovery)
    const manifestKeys = new Set(recovery.entries.map((entry) => entry.sourceKey))
    const actualKeys = await listObjectKeys(client)
    if (recovery.phase === 'backed-up') {
      await verifySourceManifest(client, recovery.entries)
      recovery.phase = 'purging'
      await writeState(state)
    } else {
      assert(
        actualKeys.every((key) => manifestKeys.has(key)),
        'A resumed purge found an object outside the recovery manifest.',
      )
      for (const key of actualKeys) {
        const entry = recovery.entries.find((candidate) => candidate.sourceKey === key)
        assert(entry, `A resumed purge cannot resolve source object ${key}.`)
        assertRawObject(await describeRawObject(client, key), entry, `Source object ${key}`)
      }
    }

    const deletedCount = (await listObjectKeys(client)).length
    await deleteObjectKeys(client, await listObjectKeys(client))
    assert((await listObjectKeys(client)).length === 0, 'Business prefix is not empty after purge.')
    recovery.phase = 'purged'
    await writeState(state)
    await writeEvidence('purge', {
      business_prefix_empty: true,
      deleted_in_this_attempt: deletedCount,
      deleted_object_count: recovery.entries.length,
      manifest_sha256: recovery.manifestSHA256,
      recovery_phase: recovery.phase,
      snapshot_id: snapshotID,
    })
  } finally {
    client.destroy()
  }
}

const restore = async (payload: Payload): Promise<void> => {
  const state = await readState()
  const recovery = state.objectRecovery
  assert(recovery, 'Restore requires a completed backup manifest.')
  const snapshotID = assertSnapshotMatches(recovery)
  assert(
    recovery.phase === 'purged' || recovery.phase === 'restoring' || recovery.phase === 'restored',
    'Restore requires the purged, restoring, or restored phase.',
  )
  const client = s3Client()
  try {
    if (recovery.phase === 'restored') {
      await verifySourceManifest(client, recovery.entries)
    } else {
      await verifyBackupManifest(client, recovery)
      const existingKeys = await listObjectKeys(client)
      const manifestKeys = new Set(recovery.entries.map((entry) => entry.sourceKey))
      assert(
        existingKeys.every((key) => manifestKeys.has(key)),
        'Restore found a business object outside the recovery manifest.',
      )
      if (recovery.phase === 'purged') {
        assert(existingKeys.length === 0, 'Purged business prefix is unexpectedly non-empty.')
        recovery.phase = 'restoring'
        await writeState(state)
      }
      for (const entry of recovery.entries) {
        if (await objectExists(client, entry.sourceKey)) {
          assertRawObject(
            await describeRawObject(client, entry.sourceKey),
            entry,
            `Partially restored object ${entry.sourceKey}`,
          )
          continue
        }
        const backupBytes = await getObjectBytes(client, entry.backupKey)
        await putVerifiedObject(
          client,
          entry.sourceKey,
          backupBytes,
          entry.contentType,
          entry.sha256,
        )
      }
      await verifySourceManifest(client, recovery.entries)
      const restoredAudit = await objectAudit(payload, client)
      assert(restoredAudit.missing.length === 0, 'Restore left missing database-referenced objects.')
      assert(restoredAudit.orphaned.length === 0, 'Restore introduced orphaned business objects.')
      recovery.phase = 'restored'
      await writeState(state)
    }

    let backupObjectsDeleted = 0
    if (recovery.backupCleaned) {
      assert(
        (await listObjectKeysUnderPrefix(client, recovery.backupPrefix)).length === 0,
        'Recovery state says the backup is clean, but backup objects remain.',
      )
    } else {
      backupObjectsDeleted = await deleteObjectPrefix(client, recovery.backupPrefix)
    }
    recovery.backupCleaned = true
    await writeState(state)
    const finalAudit = await objectAudit(payload, client)
    assert(finalAudit.missing.length === 0 && finalAudit.orphaned.length === 0, 'Post-restore object audit failed.')
    await writeEvidence('restore', {
      backup_objects_deleted: backupObjectsDeleted,
      backup_prefix_empty: true,
      database_object_audit: finalAudit,
      manifest_sha256: recovery.manifestSHA256,
      restored_object_count: recovery.entries.length,
      restored_sha256_verified: true,
      snapshot_id: snapshotID,
    })
  } finally {
    client.destroy()
  }
}

const migratePrefix = async (payload: Payload): Promise<void> => {
  const state = await readState()
  const recovery = state.objectRecovery
  assert(recovery, 'Prefix migration requires object-recovery state.')
  const snapshotID = assertSnapshotMatches(recovery)
  assert(
    recovery.phase === 'restored' && recovery.backupCleaned,
    'Prefix migration requires object recovery to be fully restored and cleaned.',
  )
  const client = s3Client()
  try {
    const sourceAudit = await objectAudit(payload, client)
    assert(sourceAudit.missing.length === 0, 'Cannot migrate a prefix with missing source objects.')
    assert(sourceAudit.orphaned.length === 0, 'Cannot migrate a prefix with orphaned source objects.')
    const mappings = await expectedStorageKeyMappings(payload)
    assert(mappings.length > 0, 'Cannot migrate an empty storage-key mapping.')
    assert(
      new Set(mappings.map((mapping) => mapping.sourceKey)).size === mappings.length,
      'More than one storage key maps to the same physical source object.',
    )
    assertExactKeys(
      mappings.map((mapping) => mapping.sourceKey),
      await listObjectKeys(client),
      'Storage-key mapping',
    )

    const migrationPrefix = temporaryObjectPrefix('migration', state.marker)
    await deleteObjectPrefix(client, migrationPrefix)
    const evidenceMappings: Array<Record<string, unknown>> = []
    let copied = false
    try {
      for (const mapping of mappings) {
        const source = await describeRawObject(client, mapping.sourceKey)
        const bytes = await getObjectBytes(client, mapping.sourceKey)
        assert(sha256(bytes) === source.sha256, `Source object ${mapping.sourceKey} changed during migration.`)
        const migratedKey = safeJoin(migrationPrefix, mapping.storageKey)
        const migrated = await putVerifiedObject(
          client,
          migratedKey,
          bytes,
          source.contentType,
          source.sha256,
        )
        const mappedRead = await getObjectBytes(
          client,
          safeJoin(migrationPrefix, mapping.storageKey),
        )
        assert(
          sha256(mappedRead) === source.sha256,
          `Storage-key read from migrated object ${migratedKey} changed content.`,
        )
        evidenceMappings.push({
          byte_size: source.byteSize,
          migrated_etag: migrated.etag,
          migrated_key: migratedKey,
          sha256: source.sha256,
          source_etag: source.etag,
          source_key: mapping.sourceKey,
          storage_key: mapping.storageKey,
        })
      }
      assertExactKeys(
        await listObjectKeysUnderPrefix(client, migrationPrefix),
        evidenceMappings.map((mapping) => String(mapping.migrated_key)),
        'Migrated prefix',
      )
      copied = true
    } finally {
      await deleteObjectPrefix(client, migrationPrefix)
    }
    assert(copied, 'Prefix migration did not complete before cleanup.')

    const mappingSHA256 = sha256(JSON.stringify(evidenceMappings))
    state.prefixMigration = {
      completed: true,
      mappingCount: evidenceMappings.length,
      mappingSHA256,
      migrationPrefix,
    }
    await writeState(state)
    const finalAudit = await objectAudit(payload, client)
    assert(finalAudit.missing.length === 0 && finalAudit.orphaned.length === 0, 'Migration changed source objects.')
    await writeEvidence('migrate-prefix', {
      mapping_count: evidenceMappings.length,
      mapping_sha256: mappingSHA256,
      mappings: evidenceMappings,
      migration_prefix: migrationPrefix,
      migrated_prefix_cleaned: true,
      public_url_inputs_used: false,
      source_prefix: businessPrefix(),
      source_objects_unchanged: true,
      snapshot_id: snapshotID,
      storage_key_reads_verified: true,
    })
  } finally {
    client.destroy()
  }
}

const setup = async (payload: Payload): Promise<void> => {
  try {
    await readFile(statePath, 'utf8')
    throw new Error('Media gate setup state already exists; refusing to create a second fixture set.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const marker = randomUUID()
  const { fixture } = await loadDomainFixture<Doc>()
  await seedPayload(payload, fixture as never)

  const admin = await (payload as any).create({
    collection: 'users',
    data: {
      email: `ci-media-admin-${marker}@synthetic.invalid`,
      password: randomBytes(32).toString('base64url'),
      role: 'admin',
    },
    overrideAccess: true,
  }) as Doc
  const clientID = `ci-media-client-${marker}`
  const clientUser = await (payload as any).create({
    collection: 'users',
    data: {
      candidateActive: true,
      candidateClientID: clientID,
      candidateTokenHash: sha256(randomBytes(48)),
      email: `ci-media-client-${marker}@synthetic.invalid`,
      password: randomBytes(32).toString('base64url'),
      role: 'candidate-client',
    },
    overrideAccess: true,
  }) as Doc

  const pngCandidate = await createCandidate(payload, clientUser, marker, 'png')
  const jpegCandidate = await createCandidate(payload, clientUser, marker, 'jpeg')
  const outageCandidate = await createCandidate(payload, clientUser, marker, 'outage')
  const pngGenerator: Generator = {
    height: 900,
    kind: 'png',
    rgba: [31, 127, 223, 255],
    width: 1600,
  }
  const jpegGenerator: Generator = {
    height: 960,
    kind: 'jpeg',
    quality: 88,
    rgba: [223, 95, 31, 255],
    width: 1440,
  }
  const outageGenerator: Generator = {
    height: 768,
    kind: 'png',
    rgba: [95, 223, 63, 255],
    width: 1366,
  }

  const pngFixture = await uploadMetadata(
    clientID,
    pngCandidate,
    pngGenerator,
    `ci-upload-png-${marker}`,
    'synthetic-first.png',
  )
  const firstPNG = await upload(payload, clientUser, pngFixture.metadata, pngFixture.bytes)
  assert(firstPNG.status === 201 && firstPNG.body.created === true, 'PNG upload was not created.')
  const renamedPNG = await upload(payload, clientUser, {
    ...pngFixture.metadata,
    filename: 'synthetic-renamed.png',
    idempotency_key: `ci-upload-png-renamed-${marker}`,
  }, pngFixture.bytes)
  assert(
    renamedPNG.status === 200 &&
      renamedPNG.body.created === false &&
      Number(renamedPNG.body.media_id) === Number(firstPNG.body.media_id),
    'Same-content renamed PNG did not deduplicate.',
  )

  const jpegFixture = await uploadMetadata(
    clientID,
    jpegCandidate,
    jpegGenerator,
    `ci-upload-jpeg-${marker}`,
    'synthetic-first.jpg',
  )
  const firstJPEG = await upload(payload, clientUser, jpegFixture.metadata, jpegFixture.bytes)
  assert(firstJPEG.status === 201 && firstJPEG.body.created === true, 'JPEG upload was not created.')

  const sharedSyntheticSourceURL = `https://synthetic.invalid/public-media/${marker}/same-url`
  await payload.update({
    collection: 'media',
    data: { sourceUrl: sharedSyntheticSourceURL },
    id: Number(firstPNG.body.media_id),
    overrideAccess: true,
  })
  const changedSourcePNG = await upload(payload, clientUser, {
    ...pngFixture.metadata,
    filename: 'synthetic-source-url-changed.png',
    idempotency_key: `ci-upload-png-source-change-${marker}`,
  }, pngFixture.bytes)
  assert(
    changedSourcePNG.status === 200 &&
      changedSourcePNG.body.created === false &&
      Number(changedSourcePNG.body.media_id) === Number(firstPNG.body.media_id),
    'Changing the source URL affected content deduplication.',
  )
  await payload.update({
    collection: 'media',
    data: { sourceUrl: sharedSyntheticSourceURL },
    id: Number(firstJPEG.body.media_id),
    overrideAccess: true,
  })
  const [sameURLPNG, sameURLJPEG] = await Promise.all([
    payload.findByID({
      collection: 'media', depth: 0, id: Number(firstPNG.body.media_id), overrideAccess: true,
    }),
    payload.findByID({
      collection: 'media', depth: 0, id: Number(firstJPEG.body.media_id), overrideAccess: true,
    }),
  ]) as Doc[]
  assert(
    Number(firstJPEG.body.media_id) !== Number(firstPNG.body.media_id) &&
      jpegFixture.sha256 !== pngFixture.sha256 &&
      sameURLPNG.sourceUrl === sharedSyntheticSourceURL &&
      sameURLJPEG.sourceUrl === sharedSyntheticSourceURL,
    'Different content under one source URL did not retain distinct media identities.',
  )

  const outageFixture = await uploadMetadata(
    clientID,
    outageCandidate,
    outageGenerator,
    `ci-upload-outage-${marker}`,
    'synthetic-outage.png',
  )
  const targetPrototype = await findFixture(payload, 'figure-prototypes', 'prototype-orbit-lin-aurora')
  const targetVersion = await findFixture(payload, 'figure-versions', 'version-p1-standard')
  const initialMainImageID = relationID(targetPrototype.mainImage)
  assert(initialMainImageID, 'The lifecycle target fixture must start with a main image.')

  const state: GateState = {
    adminUserID: Number(admin.id),
    clientID,
    clientUserID: Number(clientUser.id),
    jpeg: {
      ...jpegCandidate,
      generator: jpegGenerator,
      idempotencyKey: String(jpegFixture.metadata.idempotency_key),
      mediaID: Number(firstJPEG.body.media_id),
      perceptualHash: jpegFixture.perceptualHash,
      sha256: jpegFixture.sha256,
    },
    marker,
    outage: {
      ...outageCandidate,
      attempted: false,
      generator: outageGenerator,
      idempotencyKey: String(outageFixture.metadata.idempotency_key),
      perceptualHash: outageFixture.perceptualHash,
      sha256: outageFixture.sha256,
    },
    png: {
      ...pngCandidate,
      generator: pngGenerator,
      idempotencyKey: String(pngFixture.metadata.idempotency_key),
      mediaID: Number(firstPNG.body.media_id),
      perceptualHash: pngFixture.perceptualHash,
      sha256: pngFixture.sha256,
    },
    schemaVersion: 1,
    sharedSyntheticSourceURL,
    target: {
      initialMainImageID,
      prototypeID: Number(targetPrototype.id),
      versionID: Number(targetVersion.id),
    },
  }
  await writeState(state)
  await writeEvidence('setup', {
    candidates_created: 3,
    client_identity_created: true,
    different_content_same_source_url_distinct: true,
    jpeg_media_id: state.jpeg.mediaID,
    png_media_id: state.png.mediaID,
    same_content_deduplicated: true,
    seed_completed: true,
    synthetic_images: ['PNG', 'JPEG'],
  })
}

const audit = async (payload: Payload): Promise<void> => {
  const state = await readState()
  const client = s3Client()
  try {
    const media = [state.png, state.jpeg, ...(state.outage.mediaID ? [state.outage as MediaState] : [])]
    const summaries = []
    for (const item of media) {
      const inspected = await inspectMedia(payload, client, item.mediaID)
      assert(inspected.summary.original.sha256 === item.sha256, 'State and S3 SHA-256 differ.')
      summaries.push({ media_id: item.mediaID, ...inspected.summary })
    }
    const objectState = await objectAudit(payload, client)
    assert(objectState.missing.length === 0, 'S3 audit found missing referenced objects.')
    assert(objectState.orphaned.length === 0, 'S3 audit found orphaned objects.')
    await writeEvidence('audit', {
      media: summaries,
      object_audit: objectState,
      repeated_reads_stable: true,
      storage_key_excludes_endpoint_and_public_url: true,
    })
  } finally {
    client.destroy()
  }
}

const outage = async (payload: Payload): Promise<void> => {
  const state = await readState()
  assert(!state.outage.attempted, 'The outage attempt has already been recorded.')
  const user = await loadUser(payload, state.clientUserID)
  const fixture = await uploadMetadata(
    state.clientID,
    state.outage,
    state.outage.generator,
    state.outage.idempotencyKey,
    'synthetic-outage.png',
  )
  assert(fixture.sha256 === state.outage.sha256, 'Outage fixture generation is not deterministic.')

  const beforeMedia = await payload.count({
    collection: 'media',
    overrideAccess: true,
    where: { candidate: { equals: state.outage.candidateID } },
  })
  const beforeLogs = await payload.count({
    collection: 'operation-logs',
    overrideAccess: true,
    where: { operationType: { equals: 'candidate_media_upload' } },
  })
  const beforePrototype = await payload.findByID({
    collection: 'figure-prototypes',
    depth: 0,
    id: state.target.prototypeID,
    overrideAccess: true,
  }) as Doc
  const formalMainImage = await currentFormalMainImage(payload, state.target.prototypeID)
  assert(
    formalMainImage.mediaID === relationID(beforePrototype.mainImage),
    'Formal main-image target changed while preparing the outage read.',
  )
  let formalReadFalseSuccess = false
  let formalReadErrorClass: FormalReadErrorClass | undefined
  const unavailableClient = s3Client()
  try {
    await getObjectBytes(unavailableClient, formalMainImage.key)
    formalReadFalseSuccess = true
  } catch (error) {
    formalReadErrorClass = classifyUnavailableError(error)
  } finally {
    unavailableClient.destroy()
  }
  assert(!formalReadFalseSuccess, 'Formal main-image read returned bytes while MinIO was stopped.')
  assert(
    formalReadErrorClass,
    'Formal main-image read did not fail with an explicit service-unavailable transport class.',
  )
  const attempted = await upload(payload, user, fixture.metadata, fixture.bytes)
  assert(attempted.status === 503, `MinIO outage upload returned HTTP ${attempted.status}, not 503.`)
  assert(
    attempted.body.error_code === 'candidate_media_storage_unavailable' &&
      attempted.body.retryable === true,
    'MinIO outage upload did not return the stable retryable storage-unavailable marker.',
  )

  const afterMedia = await payload.count({
    collection: 'media',
    overrideAccess: true,
    where: { candidate: { equals: state.outage.candidateID } },
  })
  const afterLogs = await payload.count({
    collection: 'operation-logs',
    overrideAccess: true,
    where: { operationType: { equals: 'candidate_media_upload' } },
  })
  const afterPrototype = await payload.findByID({
    collection: 'figure-prototypes',
    depth: 0,
    id: state.target.prototypeID,
    overrideAccess: true,
  }) as Doc
  assert(afterMedia.totalDocs === beforeMedia.totalDocs, 'Outage left a partial media record.')
  assert(afterLogs.totalDocs === beforeLogs.totalDocs, 'Outage wrote a false-success OperationLog.')
  assert(
    relationID(afterPrototype.mainImage) === relationID(beforePrototype.mainImage),
    'Outage changed the formal main image.',
  )
  state.outage.attempted = true
  state.outage.formalRead = {
    mediaID: formalMainImage.mediaID,
    sha256: formalMainImage.sha256,
  }
  await writeState(state)
  await writeEvidence('outage', {
    database_media_delta: afterMedia.totalDocs - beforeMedia.totalDocs,
    formal_read_error_class: formalReadErrorClass,
    formal_read_failed_explicitly: true,
    formal_read_false_success: false,
    main_image_unchanged: true,
    operation_log_delta: afterLogs.totalDocs - beforeLogs.totalDocs,
    retryable: attempted.body.retryable,
    stable_error_code: attempted.body.error_code,
    upload_http_status: attempted.status,
  })
}

const recover = async (payload: Payload): Promise<void> => {
  const state = await readState()
  assert(state.outage.attempted, 'Recovery requires a recorded outage attempt.')
  assert(!state.outage.mediaID, 'Outage fixture has already recovered.')
  assert(state.outage.formalRead, 'Recovery requires the formal outage-read checkpoint.')
  const user = await loadUser(payload, state.clientUserID)
  const fixture = await uploadMetadata(
    state.clientID,
    state.outage,
    state.outage.generator,
    state.outage.idempotencyKey,
    'synthetic-outage.png',
  )
  assert(fixture.sha256 === state.outage.sha256, 'Recovery fixture generation is not deterministic.')

  const client = s3Client()
  try {
    const businessKeysBeforeFault = await listObjectKeys(client)
    const objectAuditBeforeFault = await objectAudit(payload, client)
    assert(
      objectAuditBeforeFault.missing.length === 0 && objectAuditBeforeFault.orphaned.length === 0,
      'Object audit was not clean before the post-upload fault injection.',
    )
    const [candidateBeforeFault, prototypeBeforeFault, mediaBeforeFault, logsBeforeFault, prototypesBeforeFault, versionsBeforeFault] = await Promise.all([
    payload.findByID({
      collection: 'candidate-records', depth: 0, id: state.outage.candidateID, overrideAccess: true,
    }),
    payload.findByID({
      collection: 'figure-prototypes', depth: 0, id: state.target.prototypeID, overrideAccess: true,
    }),
    payload.count({
      collection: 'media', overrideAccess: true, where: { candidate: { equals: state.outage.candidateID } },
    }),
    payload.count({
      collection: 'operation-logs', overrideAccess: true,
      where: { operationType: { equals: 'candidate_media_upload' } },
    }),
    payload.count({ collection: 'figure-prototypes', overrideAccess: true }),
    payload.count({ collection: 'figure-versions', overrideAccess: true }),
    ]) as [Doc, Doc, { totalDocs: number }, { totalDocs: number }, { totalDocs: number }, { totalDocs: number }]
    assert(
      !process.env.PAYLOAD_CI_MEDIA_UPLOAD_FAULT &&
        !process.env.PAYLOAD_CI_MEDIA_UPLOAD_FAULT_IDEMPOTENCY_KEY,
      'Candidate media fault injection must not be preconfigured.',
    )
    process.env.PAYLOAD_CI_MEDIA_UPLOAD_FAULT = 'after-operation-log-before-commit'
    process.env.PAYLOAD_CI_MEDIA_UPLOAD_FAULT_IDEMPOTENCY_KEY = state.outage.idempotencyKey
    let injectedFailure: { body: Doc; status: number } | undefined
    try {
      injectedFailure = await upload(payload, user, fixture.metadata, fixture.bytes)
    } finally {
      delete process.env.PAYLOAD_CI_MEDIA_UPLOAD_FAULT
      delete process.env.PAYLOAD_CI_MEDIA_UPLOAD_FAULT_IDEMPOTENCY_KEY
    }
    assert(injectedFailure, 'Injected post-upload failure did not return a response.')
    assert(injectedFailure.status === 503, `Injected post-upload failure returned HTTP ${injectedFailure.status}.`)
    assert(
      injectedFailure.body.error_code === 'candidate_media_commit_failed' &&
        injectedFailure.body.retryable === true &&
        injectedFailure.body.compensated === true,
      'Injected post-upload failure did not report a successful, retryable compensation.',
    )

  const [candidateAfterFault, prototypeAfterFault, mediaAfterFault, logsAfterFault, prototypesAfterFault, versionsAfterFault] = await Promise.all([
    payload.findByID({
      collection: 'candidate-records', depth: 0, id: state.outage.candidateID, overrideAccess: true,
    }),
    payload.findByID({
      collection: 'figure-prototypes', depth: 0, id: state.target.prototypeID, overrideAccess: true,
    }),
    payload.count({
      collection: 'media', overrideAccess: true, where: { candidate: { equals: state.outage.candidateID } },
    }),
    payload.count({
      collection: 'operation-logs', overrideAccess: true,
      where: { operationType: { equals: 'candidate_media_upload' } },
    }),
    payload.count({ collection: 'figure-prototypes', overrideAccess: true }),
    payload.count({ collection: 'figure-versions', overrideAccess: true }),
  ]) as [Doc, Doc, { totalDocs: number }, { totalDocs: number }, { totalDocs: number }, { totalDocs: number }]
  const businessKeysAfterFault = await listObjectKeys(client)
  const objectAuditAfterFault = await objectAudit(payload, client)
  const candidateImagesBefore = (candidateBeforeFault.images ?? []).map(relationID).filter(Boolean).sort()
  const candidateImagesAfter = (candidateAfterFault.images ?? []).map(relationID).filter(Boolean).sort()
  assertExactKeys(businessKeysAfterFault, businessKeysBeforeFault, 'Compensated upload')
  assert(
    objectAuditAfterFault.missing.length === 0 && objectAuditAfterFault.orphaned.length === 0,
    'Compensated post-upload failure left missing or orphaned business objects.',
  )
  assert(mediaAfterFault.totalDocs === mediaBeforeFault.totalDocs, 'Compensated failure left a partial media row.')
  assert(logsAfterFault.totalDocs === logsBeforeFault.totalDocs, 'Compensated failure left a success OperationLog.')
  assert(
    JSON.stringify(candidateImagesAfter) === JSON.stringify(candidateImagesBefore),
    'Compensated failure left the candidate image relation changed.',
  )
  assert(
    prototypesAfterFault.totalDocs === prototypesBeforeFault.totalDocs &&
      versionsAfterFault.totalDocs === versionsBeforeFault.totalDocs,
    'Compensated failure created a partial formal record.',
  )
  assert(
    relationID(prototypeAfterFault.mainImage) === relationID(prototypeBeforeFault.mainImage),
    'Compensated failure changed the formal main image.',
  )

    const first = await upload(payload, user, fixture.metadata, fixture.bytes)
    assert(first.status === 201 && first.body.created === true, 'Recovery upload was not created.')
    const repeated = await upload(payload, user, {
      ...fixture.metadata,
      filename: 'synthetic-outage-retry-renamed.png',
    }, fixture.bytes)
    assert(
      repeated.status === 200 &&
        repeated.body.created === false &&
        Number(repeated.body.media_id) === Number(first.body.media_id),
      'Recovered upload was not idempotent.',
    )
    state.outage.mediaID = Number(first.body.media_id)
    await writeState(state)

    const inspected = await inspectMedia(payload, client, state.outage.mediaID)
    assert(inspected.summary.original.sha256 === state.outage.sha256, 'Recovered object hash mismatch.')
    const formalMainImage = await currentFormalMainImage(payload, state.target.prototypeID)
    assert(
      formalMainImage.mediaID === state.outage.formalRead.mediaID,
      'Formal main image changed between outage and recovery.',
    )
    assert(
      formalMainImage.sha256 === state.outage.formalRead.sha256,
      'Formal main-image database hash changed between outage and recovery.',
    )
    const formalBytes = await getObjectBytes(client, formalMainImage.key)
    assert(
      sha256(formalBytes) === state.outage.formalRead.sha256,
      'Recovered formal main-image object SHA-256 mismatch.',
    )
    const finalAudit = await objectAudit(payload, client)
    assert(
      finalAudit.missing.length === 0 && finalAudit.orphaned.length === 0,
      'Recovered retry left missing or orphaned business objects.',
    )
    await writeEvidence('recover', {
      compensated_post_upload_fault: {
        business_prefix_key_count_after: businessKeysAfterFault.length,
        business_prefix_key_count_before: businessKeysBeforeFault.length,
        business_prefix_key_set_after_sha256: sha256(JSON.stringify(businessKeysAfterFault)),
        business_prefix_key_set_before_sha256: sha256(JSON.stringify(businessKeysBeforeFault)),
        business_prefix_key_sets_equal: true,
        candidate_images_unchanged: true,
        compensated: injectedFailure.body.compensated,
        database_media_delta: mediaAfterFault.totalDocs - mediaBeforeFault.totalDocs,
        fault_stage: 'after-operation-log-before-commit',
        formal_prototype_delta: prototypesAfterFault.totalDocs - prototypesBeforeFault.totalDocs,
        formal_version_delta: versionsAfterFault.totalDocs - versionsBeforeFault.totalDocs,
        main_image_unchanged: true,
        operation_log_delta: logsAfterFault.totalDocs - logsBeforeFault.totalDocs,
        missing_count_after: objectAuditAfterFault.missing.length,
        orphan_count_after: objectAuditAfterFault.orphaned.length,
        retryable: injectedFailure.body.retryable,
        stable_error_code: injectedFailure.body.error_code,
        upload_http_status: injectedFailure.status,
      },
      final_object_audit: finalAudit,
      formal_read_recovered: true,
      idempotent_retry: true,
      media_id: state.outage.mediaID,
      object_count_for_media: 3,
      original_sha256: inspected.summary.original.sha256,
      service_recovered: true,
    })
  } finally {
    client.destroy()
  }
}

const rebuildDerivativeFromOriginal = async (
  client: S3Client,
  media: Doc,
  sizeName: 'preview' | 'thumbnail',
) => {
  const size = media.sizes?.[sizeName]
  assert(media.filename && size?.filename, `Cannot rebuild missing ${sizeName} metadata.`)
  const originalKey = objectKey(media, String(media.filename))
  const derivativeKey = objectKey(media, String(size.filename))
  const original = await getObjectBytes(client, originalKey)
  const width = sizeName === 'thumbnail' ? 320 : 1280
  const derivative = await sharp(original)
    .rotate()
    .resize({ fastShrinkOnLoad: false, width, withoutEnlargement: true })
    .toBuffer()
  const metadata = await sharp(derivative).metadata()
  assert(metadata.width === Number(size.width), `${sizeName} rebuild width differs from database metadata.`)
  assert(metadata.height === Number(size.height), `${sizeName} rebuild height differs from database metadata.`)
  await client.send(new PutObjectCommand({
    Body: derivative,
    Bucket: required('S3_BUCKET'),
    ContentType: String(size.mimeType ?? media.mimeType),
    Key: derivativeKey,
  }))
  return { byte_size: derivative.length, key: derivativeKey, sha256: sha256(derivative) }
}

const lifecycle = async (payload: Payload): Promise<void> => {
  const state = await readState()
  const admin = await loadUser(payload, state.adminUserID)
  const request = await createLocalReq({ user: admin as never }, payload)
  const workItem = await openReviewWorkItem(request, {
    allowedTargetIDs: [state.target.prototypeID],
    candidateID: state.png.candidateID,
    reason: 'CI production gate media lifecycle review',
  }) as Doc

  const attached = await candidateReviewEndpoint.handler(
    await jsonRequest(payload, admin, {
      action: 'attach-version',
      candidateID: state.png.candidateID,
      expectedVersion: Number(workItem.lockVersion),
      prototypeID: state.target.prototypeID,
      reason: 'Attach synthetic candidate to the bounded CI target',
      versionID: state.target.versionID,
      workItemID: Number(workItem.id),
    }),
  )
  assert(attached.status === 200, `Attach-version review returned HTTP ${attached.status}.`)
  const advanced = await payload.findByID({
    collection: 'review-work-items',
    depth: 0,
    id: Number(workItem.id),
    overrideAccess: true,
  }) as Doc
  const selected = await candidateReviewEndpoint.handler(
    await jsonRequest(payload, admin, {
      action: 'select-main-image',
      candidateID: state.png.candidateID,
      expectedVersion: Number(advanced.lockVersion),
      mediaID: state.png.mediaID,
      prototypeID: state.target.prototypeID,
      reason: 'Promote the reviewed synthetic PNG as formal main image',
      workItemID: Number(workItem.id),
    }),
  )
  assert(selected.status === 200, `Select-main-image review returned HTTP ${selected.status}.`)

  const sourceRequest = await createLocalReq({ user: admin as never }, payload)
  const deletedAt = new Date().toISOString()
  await maintainFormalRecord(sourceRequest, {
    collection: 'source-records',
    data: { deletedAt, invalidated: true, status: 'missing' },
    id: state.png.sourceID,
    reason: 'CI lifecycle marks the synthetic candidate source missing',
  })
  const candidateRequest = await createLocalReq({ user: admin as never }, payload)
  await maintainFormalRecord(candidateRequest, {
    collection: 'candidate-records',
    data: { deletedAt, reason: 'CI lifecycle soft deletion', status: 'ignored' },
    id: state.png.candidateID,
    reason: 'CI lifecycle records candidate retirement before trashing',
  })
  const [prototype, formalMedia, trashedCandidate, trashedSource] = await Promise.all([
    payload.findByID({
      collection: 'figure-prototypes',
      depth: 0,
      id: state.target.prototypeID,
      overrideAccess: true,
    }),
    payload.findByID({ collection: 'media', depth: 0, id: state.png.mediaID, overrideAccess: true }),
    (payload as any).findByID({
      collection: 'candidate-records', depth: 0, id: state.png.candidateID, overrideAccess: true, trash: true,
    }),
    (payload as any).findByID({
      collection: 'source-records', depth: 0, id: state.png.sourceID, overrideAccess: true, trash: true,
    }),
  ]) as Doc[]
  assert(relationID(prototype.mainImage) === state.png.mediaID, 'Formal main image changed after lifecycle retirement.')
  assert(formalMedia.candidateOnly === false && formalMedia.selectedAsMain === true, 'Promoted media is not formal.')
  assert(Boolean(trashedCandidate.deletedAt), 'Candidate was not soft-deleted.')
  assert(Boolean(trashedSource.deletedAt) && trashedSource.invalidated === true, 'Source was not invalidated and soft-deleted.')

  const client = s3Client()
  try {
    const inspected = await inspectMedia(payload, client, state.png.mediaID)
    const media = inspected.media
    const thumbnailKey = objectKey(media, String(media.sizes.thumbnail.filename))
    await client.send(new DeleteObjectCommand({ Bucket: required('S3_BUCKET'), Key: thumbnailKey }))
    assert(!(await objectExists(client, thumbnailKey)), 'Synthetic thumbnail deletion probe did not delete the object.')
    const rebuilt = await rebuildDerivativeFromOriginal(client, media, 'thumbnail')
    assert(await objectExists(client, thumbnailKey), 'Thumbnail was not rebuilt from the original.')
    assert(
      rebuilt.sha256 === (inspected.summary.sizes.thumbnail as Doc).sha256,
      'Rebuilt thumbnail bytes differ from the original Payload derivative.',
    )

    const originalKey = objectKey(media, String(media.filename))
    const original = await getObjectBytes(client, originalKey)
    await client.send(new DeleteObjectCommand({ Bucket: required('S3_BUCKET'), Key: originalKey }))
    let missingOriginalRefused = false
    try {
      await rebuildDerivativeFromOriginal(client, media, 'preview')
    } catch {
      missingOriginalRefused = true
    } finally {
      await client.send(new PutObjectCommand({
        Body: original,
        Bucket: required('S3_BUCKET'),
        ContentType: String(media.mimeType),
        Key: originalKey,
      }))
    }
    assert(missingOriginalRefused, 'Derivative recovery pretended to rebuild without an original.')
    assert(sha256(await getObjectBytes(client, originalKey)) === state.png.sha256, 'Original fixture restore changed bytes.')

    const cleanAudit = await objectAudit(payload, client)
    assert(cleanAudit.missing.length === 0, 'Lifecycle audit found missing referenced objects.')
    assert(cleanAudit.orphaned.length === 0, 'Lifecycle audit found an unexpected orphan before injection.')
    const orphanKey = safeJoin(required('S3_PREFIX'), 'ci-orphan-probe', `${randomUUID()}.txt`)
    await client.send(new PutObjectCommand({
      Body: Buffer.from('synthetic orphan audit probe\n', 'utf8'),
      Bucket: required('S3_BUCKET'),
      ContentType: 'text/plain',
      Key: orphanKey,
    }))
    const injectedAudit = await objectAudit(payload, client)
    assert(injectedAudit.orphaned.includes(orphanKey), 'Object audit did not report the injected orphan.')
    await client.send(new DeleteObjectCommand({ Bucket: required('S3_BUCKET'), Key: orphanKey }))
    const finalAudit = await objectAudit(payload, client)
    assert(finalAudit.missing.length === 0 && finalAudit.orphaned.length === 0, 'Final object audit is not clean.')

    await writeEvidence('lifecycle', {
      candidate_soft_deleted: true,
      derivative_rebuild: rebuilt,
      final_object_audit: finalAudit,
      formal_main_image_id: state.png.mediaID,
      main_image_object_retained: true,
      missing_original_rebuild_refused: true,
      orphan_detection_probe: true,
      source_invalidated_and_soft_deleted: true,
    })
  } finally {
    client.destroy()
  }
}

const main = async (): Promise<void> => {
  assertRuntimeGate()
  const mode = process.argv[2] as Mode | undefined
  assert(
    mode && allowedModes.has(mode),
    'Expected mode: setup, audit, outage, recover, lifecycle, backup-manifest, purge, restore, or migrate-prefix.',
  )
  const { default: config } = await import('@payload-config')
  const payload = await getPayload({ config })
  try {
    if (mode === 'setup') await setup(payload)
    else if (mode === 'audit') await audit(payload)
    else if (mode === 'outage') await outage(payload)
    else if (mode === 'recover') await recover(payload)
    else if (mode === 'lifecycle') await lifecycle(payload)
    else if (mode === 'backup-manifest') await backupManifest(payload)
    else if (mode === 'purge') await purge()
    else if (mode === 'restore') await restore(payload)
    else await migratePrefix(payload)
  } finally {
    await payload.destroy()
  }
}

await main()
process.exit(0)
