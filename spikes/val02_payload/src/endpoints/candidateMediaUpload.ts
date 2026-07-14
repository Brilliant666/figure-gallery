import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Endpoint, PayloadRequest } from 'payload'
import sharp from 'sharp'

import { calculateAverageHash } from '@/domain/seed'
import { withinPayloadTransaction } from '@/domain/payloadDomainService'
import { requireActiveCandidateClient } from '@/security/roles'

const MAX_TEST_IMAGE_BYTES = 64 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png'])

type UploadMetadata = {
  candidate_id: number | string
  client_candidate_id: string
  client_id: string
  content_type: string
  file_size: number
  filename: string
  height: number
  idempotency_key: string
  operation: 'candidate_media_upload'
  perceptual_hash: string
  protocol_version: 2
  sha256: string
  width: number
}

const relationID = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  if (value && typeof value === 'object' && 'id' in value) {
    return relationID((value as { id: unknown }).id)
  }
  return undefined
}

const parseMetadata = (value: FormDataEntryValue | null): UploadMetadata => {
  if (typeof value !== 'string') throw new Error('Multipart field metadata must contain JSON.')
  const metadata = JSON.parse(value) as Partial<UploadMetadata>
  if (metadata.protocol_version !== 2 || metadata.operation !== 'candidate_media_upload') {
    throw new Error('Expected candidate_media_upload protocol version 2.')
  }
  for (const key of [
    'client_id',
    'client_candidate_id',
    'idempotency_key',
    'filename',
    'content_type',
    'sha256',
    'perceptual_hash',
  ] as const) {
    if (typeof metadata[key] !== 'string' || !metadata[key]?.trim()) {
      throw new Error(`${key} is required.`)
    }
  }
  for (const key of ['width', 'height', 'file_size'] as const) {
    if (!Number.isInteger(metadata[key]) || Number(metadata[key]) < 1) {
      throw new Error(`${key} must be a positive integer.`)
    }
  }
  if (!relationID(metadata.candidate_id)) throw new Error('candidate_id must be a numeric Payload ID.')
  if (!/^[a-f0-9]{64}$/i.test(metadata.sha256!)) throw new Error('sha256 must be 64 hexadecimal characters.')
  if (!/^[a-f0-9]{16}$/i.test(metadata.perceptual_hash!)) {
    throw new Error('perceptual_hash must be a 64-bit hexadecimal aHash.')
  }
  if (!ALLOWED_TYPES.has(metadata.content_type!)) throw new Error('Only PNG and JPEG are accepted.')
  if (path.basename(metadata.filename!) !== metadata.filename) throw new Error('filename must not contain a path.')
  return metadata as UploadMetadata
}

const parseMultipart = async (req: PayloadRequest): Promise<{ bytes: Buffer; file: File; metadata: UploadMetadata }> => {
  const formData = await (req as unknown as Request).formData()
  const metadata = parseMetadata(formData.get('metadata'))
  const value = formData.get('file')
  if (!(value instanceof File)) throw new Error('Multipart field file is required.')
  if (value.size > MAX_TEST_IMAGE_BYTES || metadata.file_size > MAX_TEST_IMAGE_BYTES) {
    throw new Error(`Candidate image exceeds the ${MAX_TEST_IMAGE_BYTES}-byte test limit.`)
  }
  const bytes = Buffer.from(await value.arrayBuffer())
  return { bytes, file: value, metadata }
}

const validateImage = async (bytes: Buffer, file: File, metadata: UploadMetadata) => {
  if (bytes.length !== file.size || bytes.length !== metadata.file_size) {
    throw new Error('Declared file_size does not match the uploaded bytes.')
  }
  if (file.type !== metadata.content_type) {
    throw new Error('Multipart and declared content types do not match.')
  }
  const image = await sharp(bytes, { failOn: 'error' }).metadata()
  const detectedType = image.format === 'png' ? 'image/png' : image.format === 'jpeg' ? 'image/jpeg' : undefined
  if (!detectedType || detectedType !== metadata.content_type) {
    throw new Error('Declared content type does not match decoded image content.')
  }
  if (image.width !== metadata.width || image.height !== metadata.height) {
    throw new Error('Declared dimensions do not match decoded image dimensions.')
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== metadata.sha256.toLowerCase()) throw new Error('Declared SHA-256 does not match uploaded content.')
  const perceptualHash = await calculateAverageHash(bytes)
  if (perceptualHash !== metadata.perceptual_hash.toLowerCase()) {
    throw new Error('Declared perceptual hash does not match uploaded content.')
  }
  return { detectedType, format: image.format!.toUpperCase(), perceptualHash, sha256 }
}

const readOwner = (doc: Record<string, unknown>): number | undefined =>
  relationID(doc.candidateOwner)

const candidateMediaUploadHandler: Endpoint['handler'] = async (req) => {
    try {
      const activeClient = await requireActiveCandidateClient(req)
      const clientID = activeClient.clientID
      const ownerID = relationID(activeClient.userID)
      if (!ownerID) throw new Error('Candidate client user ID is required.')
      const { bytes, file, metadata } = await parseMultipart(req)
      if (metadata.client_id !== clientID) throw new Error('client_id does not match the authenticated client.')
      const verified = await validateImage(bytes, file, metadata)
      const candidateID = relationID(metadata.candidate_id)!
      const payload = req.payload as any
      const candidate = await payload.findByID({
        collection: 'candidate-records',
        depth: 0,
        id: candidateID,
        overrideAccess: true,
        req,
      })
      if (readOwner(candidate) !== ownerID) {
        throw new Error('Candidate media upload cannot modify a candidate owned by another client.')
      }
      if (candidate.externalKey !== metadata.client_candidate_id) {
        throw new Error('client_candidate_id does not match the candidate record.')
      }

      const byIdempotency = await payload.find({
        collection: 'media',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req,
        where: {
          and: [
            { candidateOwner: { equals: ownerID } },
            { idempotencyKey: { equals: metadata.idempotency_key } },
          ],
        },
      })
      const prior = byIdempotency.docs[0]
      if (prior && prior.sha256 !== verified.sha256) {
        throw new Error('Idempotency key was already used for different content.')
      }
      const byContent = await payload.find({
        collection: 'media',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req,
        where: {
          and: [
            { candidate: { equals: candidateID } },
            { candidateOwner: { equals: ownerID } },
            { sha256: { equals: verified.sha256 } },
          ],
        },
      })
      const existing = prior ?? byContent.docs[0]
      if (existing) {
        return Response.json({ created: false, media_id: existing.id, ok: true, storage_key: existing.storageKey })
      }

      const extension = verified.detectedType === 'image/png' ? 'png' : 'jpg'
      const objectPrefix = `candidate/${clientID}/${verified.sha256.slice(0, 2)}`
      const contentFilename = `${verified.sha256}.${extension}`
      // storageKey is the stable business identity below the deploy-specific
      // S3 root prefix. The public URL and S3 endpoint are deliberately absent.
      const storageKey = `${objectPrefix}/${contentFilename}`
      req.context = { ...req.context, candidateSync: true }
      const media = await withinPayloadTransaction(req, async () => {
        const created = await payload.create({
          collection: 'media',
          data: {
            byteSize: bytes.length,
            candidate: candidateID,
            candidateOnly: true,
            candidateOwner: ownerID,
            clientCandidateID: metadata.client_candidate_id,
            format: verified.format,
            idempotencyKey: metadata.idempotency_key,
            isAdult: false,
            isSourceHomepage: false,
            perceptualHash: verified.perceptualHash,
            pixelHeight: metadata.height,
            pixelWidth: metadata.width,
            ...(process.env.S3_ENABLED === 'true' ? { prefix: objectPrefix } : {}),
            presentInLatestSource: true,
            selectedAsMain: false,
            sha256: verified.sha256,
            sourceUrl: `https://synthetic.invalid/candidate-upload/${verified.sha256}`,
            storageKey,
          },
          file: {
            data: bytes,
            mimetype: verified.detectedType,
            name: contentFilename,
            size: bytes.length,
          },
          overrideAccess: true,
          req,
        })
        const imageIDs = [
          ...new Set(
            [...(candidate.images ?? []), created.id]
              .map(relationID)
              .filter((id): id is number => id !== undefined),
          ),
        ]
        await payload.update({
          collection: 'candidate-records',
          data: { images: imageIDs },
          id: candidateID,
          overrideAccess: true,
          req,
        })
        await payload.create({
          collection: 'operation-logs',
          data: {
            actor: ownerID,
            actorLabel: `candidate-client:${clientID}`,
            afterState: { mediaID: created.id, sha256: verified.sha256, storageKey },
            beforeState: { mediaID: null },
            operationID: randomUUID(),
            operationType: 'candidate_media_upload',
            reason: 'Candidate protocol v2 synthetic media upload',
            relatedRecords: { candidateID, mediaID: created.id },
            scope: { candidateIDs: [candidateID] },
            undone: false,
          },
          overrideAccess: true,
          req,
        })
        return created
      })
      return Response.json(
        { created: true, media_id: media.id, ok: true, storage_key: storageKey },
        { status: 201 },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Candidate media upload failed.'
      const status = message.includes('test limit')
        ? 413
        : message.includes('another client') || message.includes('access') || message.includes('authenticated') || message.includes('disabled') || message.includes('revoked') || message.includes('required')
          ? 403
          : message.includes('Idempotency')
            ? 409
            : 400
      return Response.json({ error: message }, { status })
    } finally {
      if (req.context) delete req.context.candidateSync
    }
}

export const candidateMediaUploadEndpoint: Endpoint = {
  path: '/upload-media',
  method: 'post',
  handler: candidateMediaUploadHandler,
}

/** Root alias matching the framework-neutral Python client contract. */
export const rootCandidateMediaUploadEndpoint: Endpoint = {
  path: '/val02b/candidate-media/upload',
  method: 'post',
  handler: candidateMediaUploadHandler,
}
