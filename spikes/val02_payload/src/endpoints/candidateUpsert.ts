import type { Endpoint, PayloadRequest } from 'payload'

import { withinPayloadTransaction } from '@/domain/payloadDomainService'
import { canonicalizeSourceURL, makeSourceKey } from '@/domain/sourceKey'
import { assertNoHpoiURL } from '@/security/networkGuard'
import {
  isCandidateClientUser,
  requireActiveCandidateClient,
} from '@/security/roles'

type CandidateImageInput = {
  file_size?: null | number
  format: string
  generator?: { height: number; rgba: [number, number, number, number]; width: number }
  height?: number
  id: string
  is_adult: boolean
  is_source_homepage: boolean
  perceptual_hash?: null | string
  present_in_latest_source: boolean
  sha256?: null | string
  source_url: string
  storage_key: string
  width?: number
}

type CandidateInput = {
  id: string
  images: CandidateImageInput[]
  match_state?: string
  proposed_manufacturer_status?: string
  raw_category?: null | string
  raw_character_names?: string[]
  raw_date?: null | string
  raw_manufacturer?: null | string
  raw_scale?: null | string
  raw_snapshot: Record<string, unknown>
  raw_title: string
  raw_work_name?: null | string
  requested_changes?: Record<string, unknown>
  source: {
    is_stale?: boolean
    last_synced_at?: null | string
    source_item_id?: null | string
    source_status: string
    source_type: string
    source_url: string
  }
}

type CandidateProtocol = {
  candidate: CandidateInput
  operation: 'candidate_upsert'
  protocol_version: 1
}

const forbiddenMutationKeys = new Set([
  'figureprototype',
  'figureversion',
  'mainimage',
  'mainimageid',
  'prototype',
  'selectedasmain',
  'targetprototype',
  'targetversion',
])

const normalizedKey = (key: string): string => key.replace(/[-_]/g, '').toLowerCase()

const rejectFormalMutationFields = (body: Record<string, unknown>): void => {
  const inspect = (value: unknown, label: string) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (forbiddenMutationKeys.has(normalizedKey(key))) {
        throw new Error(`Forbidden formal mutation field at ${label}.${key}.`)
      }
    }
  }
  inspect(body, 'request')
  const candidate = body.candidate
  inspect(candidate, 'candidate')
  if (candidate && typeof candidate === 'object') {
    const candidateObject = candidate as Record<string, unknown>
    inspect(candidateObject.source, 'candidate.source')
    if (Array.isArray(candidateObject.images)) {
      candidateObject.images.forEach((image, index) => inspect(image, `candidate.images[${index}]`))
    }
  }
}

const jsonError = (message: string, status: number) => Response.json({ error: message }, { status })

const sameJSON = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const sourceAuditState = (doc: any) =>
  doc
    ? {
        id: doc.id,
        invalidated: doc.invalidated,
        lastSyncedAt: doc.lastSyncedAt ?? null,
        sourceItemId: doc.sourceItemId ?? null,
        sourceKey: doc.sourceKey,
        sourceType: doc.sourceType,
        sourceUrl: doc.sourceUrl,
        status: doc.status,
      }
    : null

const candidateAuditState = (doc: any) =>
  doc
    ? {
        externalKey: doc.externalKey,
        id: doc.id,
        matchState: doc.matchState,
        rawSnapshot: doc.rawSnapshot,
        rawTitle: doc.rawTitle,
        requestedChanges: doc.requestedChanges ?? {},
        source: typeof doc.source === 'object' ? doc.source?.id : doc.source,
      }
    : null

const candidateComparableState = (doc: any) => ({
  matchState: doc?.matchState ?? null,
  proposedManufacturerStatus: doc?.proposedManufacturerStatus ?? null,
  rawCategory: doc?.rawCategory ?? null,
  rawCharacterNames: doc?.rawCharacterNames ?? [],
  rawDate: doc?.rawDate ?? null,
  rawManufacturer: doc?.rawManufacturer ?? null,
  rawScale: doc?.rawScale ?? null,
  rawSnapshot: doc?.rawSnapshot ?? {},
  rawTitle: doc?.rawTitle ?? null,
  rawWorkName: doc?.rawWorkName ?? null,
  requestedChanges: doc?.requestedChanges ?? {},
  source: typeof doc?.source === 'object' ? doc.source?.id : (doc?.source ?? null),
})

const mediaComparableState = (doc: any) => ({
  byteSize: doc?.byteSize ?? null,
  format: doc?.format ?? null,
  isAdult: Boolean(doc?.isAdult),
  isSourceHomepage: Boolean(doc?.isSourceHomepage),
  perceptualHash: doc?.perceptualHash ?? null,
  pixelHeight: doc?.pixelHeight ?? null,
  pixelWidth: doc?.pixelWidth ?? null,
  presentInLatestSource: Boolean(doc?.presentInLatestSource),
  sha256: doc?.sha256 ?? null,
  sourceUrl: doc?.sourceUrl ?? null,
  storageKey: doc?.storageKey ?? null,
})

const parseBody = async (req: PayloadRequest): Promise<CandidateProtocol> => {
  if (!req.json) throw new Error('A JSON request body is required.')
  const body = (await req.json()) as Partial<CandidateProtocol>
  rejectFormalMutationFields(body as Record<string, unknown>)
  if (body.protocol_version !== 1 || body.operation !== 'candidate_upsert' || !body.candidate) {
    throw new Error('Expected candidate_upsert protocol version 1.')
  }
  if (!body.candidate.id || !body.candidate.raw_title || !body.candidate.source) {
    throw new Error('Candidate id, raw_title and source are required.')
  }
  return body as CandidateProtocol
}

const upsertSource = async (req: PayloadRequest, input: CandidateInput['source']) => {
  const payload = req.payload as any
  assertNoHpoiURL(input.source_url, 'Source URL')
  const canonicalUrl = canonicalizeSourceURL(input.source_url)
  const sourceKey = makeSourceKey({
    sourceItemId: input.source_item_id,
    sourceType: input.source_type,
    sourceUrl: input.source_url,
  })
  const exact = await payload.find({
    collection: 'source-records',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { sourceKey: { equals: sourceKey } },
  })

  let existing = exact.docs[0]
  if (!existing && input.source_item_id) {
    const fallback = await payload.find({
      collection: 'source-records',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: {
        and: [
          { sourceType: { equals: input.source_type } },
          { canonicalUrl: { equals: canonicalUrl } },
        ],
      },
    })
    existing = fallback.docs[0]
  }

  if (existing) {
    const owner =
      typeof existing.candidateOwner === 'object'
        ? existing.candidateOwner?.id
        : existing.candidateOwner
    if (existing.candidateOnly !== true) {
      throw new Error('Candidate upsert cannot reuse or modify a formal source record.')
    }
    if (isCandidateClientUser(req.user) && String(owner) !== String(req.user?.id)) {
      throw new Error('Candidate upsert cannot modify a source owned by another client.')
    }
  }

  const data = {
    candidateOnly: true,
    candidateOwner: isCandidateClientUser(req.user) ? req.user?.id : undefined,
    canonicalUrl,
    invalidated: input.is_stale === true,
    lastSyncedAt: input.last_synced_at ?? undefined,
    rawSnapshot: {},
    sourceItemId: input.source_item_id ?? undefined,
    sourceKey,
    sourceType: input.source_type,
    sourceUrl: input.source_url,
    status: input.source_status,
  }
  const beforeState = sourceAuditState(existing)
  const doc = existing
    ? await payload.update({
        collection: 'source-records',
        data,
        id: existing.id,
        overrideAccess: true,
        req,
      })
    : await payload.create({
        collection: 'source-records',
        data,
        overrideAccess: true,
        req,
      })
  return {
    beforeState,
    changed: beforeState === null || !sameJSON(beforeState, sourceAuditState(doc)),
    doc,
  }
}

const upsertCandidateMedia = async (
  req: PayloadRequest,
  candidateID: number,
  images: CandidateImageInput[],
): Promise<{ changed: boolean; ids: number[] }> => {
  const payload = req.payload as any
  const ids: number[] = []
  let changed = false
  for (const image of images) {
    assertNoHpoiURL(image.source_url, 'Candidate image source URL')
    const existing = await payload.find({
      collection: 'media',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { storageKey: { equals: image.storage_key } },
    })
    const generator = image.generator
    const existingDoc = existing.docs[0]
    const existingCandidateID = existingDoc
      ? typeof existingDoc.candidate === 'object'
        ? existingDoc.candidate?.id
        : existingDoc.candidate
      : undefined
    const data = {
      byteSize: image.file_size ?? undefined,
      candidate: candidateID,
      candidateOnly: true,
      format: image.format,
      isAdult: image.is_adult,
      isSourceHomepage: image.is_source_homepage,
      perceptualHash: image.perceptual_hash ?? undefined,
      pixelHeight: image.height ?? generator?.height,
      pixelWidth: image.width ?? generator?.width,
      presentInLatestSource: image.present_in_latest_source,
      selectedAsMain: false,
      sha256: image.sha256 ?? `metadata-pending:${image.id}`,
      sourceUrl: image.source_url,
      storageKey: image.storage_key,
    }
    if (existingDoc?.candidateOnly === false) {
      if (
        existingDoc.selectedAsMain === true &&
        existingDoc.prototype &&
        existingCandidateID !== undefined &&
        String(existingCandidateID) === String(candidateID)
      ) {
        changed = changed || !sameJSON(mediaComparableState(existingDoc), mediaComparableState(data))
        ids.push(existingDoc.id)
        continue
      }
      throw new Error(`Candidate image storage key is already owned by formal media: ${image.storage_key}`)
    }
    if (
      existingDoc &&
      (existingCandidateID === undefined || String(existingCandidateID) !== String(candidateID))
    ) {
      throw new Error(`Candidate image storage key is already owned by another candidate: ${image.storage_key}`)
    }
    changed = changed || !existingDoc || !sameJSON(mediaComparableState(existingDoc), mediaComparableState(data))
    const doc = existingDoc
      ? await payload.update({
          collection: 'media',
          data,
          id: existingDoc.id,
          overrideAccess: true,
          req,
        })
      : await payload.create({
          collection: 'media',
          data,
          overrideAccess: true,
          req,
        })
    ids.push(doc.id)
  }
  return { changed, ids }
}

const recordCandidateOperation = async (
  req: PayloadRequest,
  input: {
    afterState: Record<string, unknown>
    beforeState: Record<string, unknown>
    candidateID: number
    created: boolean
    sourceID: number
  },
) => {
  if (req.context?.testFailBeforeOperationLog === true) {
    throw new Error('Injected candidate upsert failure before OperationLog.')
  }
  const payload = req.payload as any
  const user = req.user as undefined | { email?: string; id?: number | string }
  await payload.create({
    collection: 'operation-logs',
    data: {
      actor: user?.id,
      actorLabel: user?.email ?? (user?.id ? `user:${user.id}` : 'candidate-endpoint'),
      afterState: input.afterState,
      beforeState: input.beforeState,
      operationType: 'candidate_upsert',
      reason: 'Candidate protocol v1 upsert',
      relatedRecords: { candidateID: input.candidateID, sourceID: input.sourceID },
      undone: false,
    },
    overrideAccess: true,
    req,
  })
}

export const candidateUpsertEndpoint: Endpoint = {
  path: '/upsert',
  method: 'post',
  handler: async (req) => {
    try {
      const activeClient = await requireActiveCandidateClient(req)
      req.context = { ...req.context, candidateSync: true }
      const payload = req.payload as any
      const { candidate } = await parseBody(req)
      const outcome = await withinPayloadTransaction(req, async () => {
        const sourceOutcome = await upsertSource(req, candidate.source)
        const source = sourceOutcome.doc
        const existing = await payload.find({
          collection: 'candidate-records',
          depth: 0,
          limit: 1,
          overrideAccess: true,
          req,
          where: { source: { equals: source.id } },
        })
        const candidateData = {
          candidateOwner: req.user?.id,
          externalKey: existing.docs[0]?.externalKey ?? candidate.id,
          matchState: candidate.match_state ?? 'character_pending',
          proposedManufacturerStatus: candidate.proposed_manufacturer_status ?? 'draft',
          rawCategory: candidate.raw_category ?? undefined,
          rawCharacterNames: candidate.raw_character_names ?? [],
          rawDate: candidate.raw_date ?? undefined,
          rawManufacturer: candidate.raw_manufacturer ?? undefined,
          rawScale: candidate.raw_scale ?? undefined,
          rawSnapshot: candidate.raw_snapshot,
          rawTitle: candidate.raw_title,
          rawWorkName: candidate.raw_work_name ?? undefined,
          requestedChanges: candidate.requested_changes ?? {},
          source: source.id,
        }
        const beforeCandidate = existing.docs[0]
        const wasCreated = !beforeCandidate
        const candidateFieldsChanged =
          !beforeCandidate ||
          !sameJSON(candidateComparableState(beforeCandidate), candidateComparableState(candidateData))
        const candidateDoc = beforeCandidate
          ? await payload.update({
              collection: 'candidate-records',
              data: candidateData,
              id: beforeCandidate.id,
              overrideAccess: true,
              req,
            })
          : await payload.create({
              collection: 'candidate-records',
              data: candidateData,
              overrideAccess: true,
              req,
            })
        const mediaOutcome = await upsertCandidateMedia(req, candidateDoc.id, candidate.images ?? [])
        const previousMediaIDs = (beforeCandidate?.images ?? []).map((value: any) =>
          typeof value === 'object' ? value.id : value,
        )
        const imagesChanged = !sameJSON(previousMediaIDs, mediaOutcome.ids)
        const changed =
          wasCreated ||
          sourceOutcome.changed ||
          candidateFieldsChanged ||
          mediaOutcome.changed ||
          imagesChanged
        const shouldQueueReview =
          !wasCreated &&
          changed &&
          (beforeCandidate.status === 'accepted' || beforeCandidate.status === 'merged')
        const finalCandidate = await payload.update({
          collection: 'candidate-records',
          data: {
            images: mediaOutcome.ids,
            ...(shouldQueueReview ? { status: 'update_pending' } : {}),
          },
          id: candidateDoc.id,
          overrideAccess: true,
          req,
        })
        await recordCandidateOperation(req, {
          afterState: {
            candidate: candidateAuditState(finalCandidate),
            mediaIDs: mediaOutcome.ids,
            source: sourceAuditState(source),
          },
          beforeState: {
            candidate: candidateAuditState(existing.docs[0]),
            source: sourceOutcome.beforeState,
          },
          candidateID: candidateDoc.id,
          created: wasCreated,
          sourceID: source.id,
        })
        return {
          candidateDoc: finalCandidate,
          changed,
          mediaIDs: mediaOutcome.ids,
          source,
          wasCreated,
        }
      })
      return Response.json(
        {
          candidate_id: outcome.candidateDoc.id,
          created: outcome.wasCreated,
          media_ids: outcome.mediaIDs,
          ok: true,
          outcome: outcome.wasCreated ? 'created' : outcome.changed ? 'updated' : 'unchanged',
          source_id: outcome.source.id,
          client_id: activeClient.clientID,
        },
        { status: outcome.wasCreated ? 201 : 200 },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Candidate upsert failed.'
      return jsonError(
        message,
        message.includes('access') || message.includes('disabled') || message.includes('revoked') || message.includes('required') || message.includes('Forbidden')
          ? 403
          : 400,
      )
    } finally {
      if (req.context) delete req.context.candidateSync
    }
  },
}
