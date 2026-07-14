import type { Payload, PayloadRequest } from 'payload'

type RecordID = number

type RelationshipSnapshot = {
  candidateIDs: RecordID[]
  mediaIDs: RecordID[]
  sourceIDs: RecordID[]
  versionIDs: RecordID[]
}

type MergeInput = {
  mergedPrototypeID: RecordID
  reason: string
  retainedPrototypeID: RecordID
}

type MergeTestHooks = {
  /** Test-only fault injection; never wired to HTTP. */
  afterFirstRelationMove?: () => Promise<void> | void
}

type SplitInput = {
  candidateIDs?: RecordID[]
  mediaIDs?: RecordID[]
  newPrototype: Record<string, unknown>
  originPrototypeID: RecordID
  reason: string
  sourceIDs?: RecordID[]
  versionIDs?: RecordID[]
}

const relationID = (value: unknown): RecordID | undefined => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === 'number') return id
    if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id)
  }
  return undefined
}

const actor = (req: PayloadRequest): { actor?: RecordID; actorLabel: string } => {
  const id = relationID(req.user)
  const email =
    req.user && typeof req.user === 'object' && 'email' in req.user
      ? String((req.user as { email?: unknown }).email ?? '')
      : ''
  return { actor: id, actorLabel: email || (id ? `user:${id}` : 'system') }
}

const findRelationIDs = async (
  payload: Payload,
  req: PayloadRequest,
  collection: 'candidate-records' | 'figure-versions' | 'media' | 'source-records',
  field: string,
  prototypeID: RecordID,
): Promise<RecordID[]> => {
  const result = await payload.find({
    collection,
    depth: 0,
    limit: 0,
    overrideAccess: true,
    req,
    where: { [field]: { equals: prototypeID } },
  })
  return result.docs.map((doc) => doc.id)
}

const snapshotRelationships = async (
  payload: Payload,
  req: PayloadRequest,
  prototypeID: RecordID,
): Promise<RelationshipSnapshot> => ({
  candidateIDs: await findRelationIDs(payload, req, 'candidate-records', 'targetPrototype', prototypeID),
  mediaIDs: await findRelationIDs(payload, req, 'media', 'prototype', prototypeID),
  sourceIDs: await findRelationIDs(payload, req, 'source-records', 'prototype', prototypeID),
  versionIDs: await findRelationIDs(payload, req, 'figure-versions', 'prototype', prototypeID),
})

const updateIDs = async (
  payload: Payload,
  req: PayloadRequest,
  collection: 'candidate-records' | 'figure-versions' | 'media' | 'source-records',
  ids: RecordID[],
  data: Record<string, unknown>,
): Promise<void> => {
  for (const id of ids) {
    await payload.update({ collection, data, id, overrideAccess: true, req })
  }
}

const validateMoveIDs = async (
  payload: Payload,
  req: PayloadRequest,
  collection: 'candidate-records' | 'figure-versions' | 'media' | 'source-records',
  field: 'prototype' | 'targetPrototype',
  ids: RecordID[],
  originPrototypeID: RecordID,
): Promise<void> => {
  for (const id of ids) {
    const doc = await (payload as any).findByID({
      collection,
      depth: 0,
      id,
      overrideAccess: true,
      req,
    })
    if (relationID(doc[field]) !== originPrototypeID) {
      throw new Error(`${collection}:${id} does not belong to origin prototype ${originPrototypeID}.`)
    }
  }
}

const relationshipIDs = (value: unknown): RecordID[] =>
  (Array.isArray(value) ? value : [])
    .map(relationID)
    .filter((id): id is RecordID => id !== undefined)

const validateSplitClosure = async (
  payload: Payload,
  req: PayloadRequest,
  moved: RelationshipSnapshot,
  originPrototypeID: RecordID,
): Promise<void> => {
  const [origin, candidates, versions, sources, media] = await Promise.all([
    payload.findByID({
      collection: 'figure-prototypes',
      depth: 0,
      id: originPrototypeID,
      overrideAccess: true,
      req,
    }),
    payload.find({
      collection: 'candidate-records',
      depth: 0,
      limit: 0,
      overrideAccess: true,
      req,
      where: { targetPrototype: { equals: originPrototypeID } },
    }),
    payload.find({
      collection: 'figure-versions',
      depth: 0,
      limit: 0,
      overrideAccess: true,
      req,
      where: { prototype: { equals: originPrototypeID } },
    }),
    payload.find({
      collection: 'source-records',
      depth: 0,
      limit: 0,
      overrideAccess: true,
      req,
      where: { prototype: { equals: originPrototypeID } },
    }),
    payload.find({
      collection: 'media',
      depth: 0,
      limit: 0,
      overrideAccess: true,
      req,
      where: { prototype: { equals: originPrototypeID } },
    }),
  ])

  const movedCandidateIDs = new Set(moved.candidateIDs)
  const movedMediaIDs = new Set(moved.mediaIDs)
  const movedSourceIDs = new Set(moved.sourceIDs)
  const movedVersionIDs = new Set(moved.versionIDs)
  const originMediaIDs = new Set(media.docs.map((doc) => doc.id))
  const originSourceIDs = new Set(sources.docs.map((doc) => doc.id))
  const originVersionIDs = new Set(versions.docs.map((doc) => doc.id))

  const mainImageID = relationID(origin.mainImage)
  if (mainImageID !== undefined && movedMediaIDs.has(mainImageID)) {
    throw new Error('A split cannot move the origin main image without an explicit replacement workflow.')
  }

  for (const candidate of candidates.docs) {
    const candidateMoved = movedCandidateIDs.has(candidate.id)
    const sourceID = relationID(candidate.source)
    const targetVersionID = relationID(candidate.targetVersion)
    const imageIDs = relationshipIDs(candidate.images)
    const touchesMovedRelation =
      (sourceID !== undefined && movedSourceIDs.has(sourceID)) ||
      (targetVersionID !== undefined && movedVersionIDs.has(targetVersionID)) ||
      imageIDs.some((id) => movedMediaIDs.has(id))

    if (touchesMovedRelation && !candidateMoved) {
      throw new Error(`Split relation closure requires candidate-records:${candidate.id} to move.`)
    }
    if (!candidateMoved) continue
    if (
      targetVersionID !== undefined &&
      originVersionIDs.has(targetVersionID) &&
      !movedVersionIDs.has(targetVersionID)
    ) {
      throw new Error(`Split relation closure requires figure-versions:${targetVersionID} to move.`)
    }
    if (sourceID !== undefined && originSourceIDs.has(sourceID) && !movedSourceIDs.has(sourceID)) {
      throw new Error(`Split relation closure requires source-records:${sourceID} to move.`)
    }
    for (const imageID of imageIDs) {
      if (originMediaIDs.has(imageID) && !movedMediaIDs.has(imageID)) {
        throw new Error(`Split relation closure requires media:${imageID} to move.`)
      }
    }
  }
}

export const withinPayloadTransaction = async <T>(
  req: PayloadRequest,
  operation: () => Promise<T>,
): Promise<T> => {
  if (req.transactionID) return operation()
  const transactionID = await req.payload.db.beginTransaction()
  if (transactionID === null) return operation()

  req.transactionID = transactionID
  try {
    const result = await operation()
    await req.payload.db.commitTransaction(transactionID)
    return result
  } catch (error) {
    await req.payload.db.rollbackTransaction(transactionID)
    throw error
  } finally {
    delete req.transactionID
  }
}

const createOperationLog = async (
  req: PayloadRequest,
  input: {
    afterState: Record<string, unknown>
    beforeState: Record<string, unknown>
    inversePayload?: Record<string, unknown>
    operationType:
      | 'accept_field'
      | 'attach_version'
      | 'candidate_upsert'
      | 'create_prototype'
      | 'defer_candidate'
      | 'ignore_candidate'
      | 'merge'
      | 'reject_field'
      | 'select_main_image'
      | 'split'
      | 'undo_merge'
      | 'undo_split'
    reason: string
    relatedRecords: Record<string, unknown>
  },
) =>
  req.payload.create({
    collection: 'operation-logs',
    data: { ...actor(req), ...input, undone: false },
    overrideAccess: true,
    req,
  })

export const mergePrototypes = async (
  req: PayloadRequest,
  input: MergeInput,
  testHooks: MergeTestHooks = {},
) =>
  withinPayloadTransaction(req, async () => {
    if (input.retainedPrototypeID === input.mergedPrototypeID) {
      throw new Error('A prototype cannot be merged into itself.')
    }

    const [retained, merged, moved] = await Promise.all([
      req.payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: input.retainedPrototypeID,
        overrideAccess: true,
        req,
      }),
      req.payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: input.mergedPrototypeID,
        overrideAccess: true,
        req,
      }),
      snapshotRelationships(req.payload, req, input.mergedPrototypeID),
    ])

    const retainedCharacterIDs = (retained.characters ?? [])
      .map(relationID)
      .filter((id): id is number => id !== undefined)
    const mergedCharacterIDs = (merged.characters ?? [])
      .map(relationID)
      .filter((id): id is number => id !== undefined)
    const mergedCharacterSet = [...new Set([...retainedCharacterIDs, ...mergedCharacterIDs])]
    await req.payload.update({
      collection: 'figure-prototypes',
      data: { characters: mergedCharacterSet },
      id: input.retainedPrototypeID,
      overrideAccess: true,
      req,
    })

    await updateIDs(req.payload, req, 'figure-versions', moved.versionIDs, {
      prototype: input.retainedPrototypeID,
    })
    await testHooks.afterFirstRelationMove?.()
    await updateIDs(req.payload, req, 'source-records', moved.sourceIDs, {
      prototype: input.retainedPrototypeID,
    })
    await updateIDs(req.payload, req, 'candidate-records', moved.candidateIDs, {
      targetPrototype: input.retainedPrototypeID,
    })
    await updateIDs(req.payload, req, 'media', moved.mediaIDs, {
      prototype: input.retainedPrototypeID,
    })
    await req.payload.update({
      collection: 'figure-prototypes',
      data: { mergedInto: input.retainedPrototypeID, publicationStatus: 'merged' },
      id: input.mergedPrototypeID,
      overrideAccess: true,
      req,
    })

    return createOperationLog(req, {
      afterState: { mergedInto: input.retainedPrototypeID, moved },
      beforeState: {
        mergedInto: relationID(merged.mergedInto) ?? null,
        mergedPublicationStatus: merged.publicationStatus,
        retainedCharacterIDs,
        retainedMainImage: relationID(retained.mainImage) ?? null,
        moved,
      },
      inversePayload: {
        mergedInto: relationID(merged.mergedInto) ?? null,
        mergedPublicationStatus: merged.publicationStatus,
        mergedPrototypeID: input.mergedPrototypeID,
        moved,
        retainedCharacterIDs,
        retainedPrototypeID: input.retainedPrototypeID,
      },
      operationType: 'merge',
      reason: input.reason,
      relatedRecords: {
        mergedPrototypeID: input.mergedPrototypeID,
        retainedPrototypeID: input.retainedPrototypeID,
      },
    })
  })

export const splitPrototype = async (req: PayloadRequest, input: SplitInput) =>
  withinPayloadTransaction(req, async () => {
    const moved: RelationshipSnapshot = {
      candidateIDs: input.candidateIDs ?? [],
      mediaIDs: input.mediaIDs ?? [],
      sourceIDs: input.sourceIDs ?? [],
      versionIDs: input.versionIDs ?? [],
    }
    await validateMoveIDs(
      req.payload,
      req,
      'figure-versions',
      'prototype',
      moved.versionIDs,
      input.originPrototypeID,
    )
    await validateMoveIDs(
      req.payload,
      req,
      'source-records',
      'prototype',
      moved.sourceIDs,
      input.originPrototypeID,
    )
    await validateMoveIDs(
      req.payload,
      req,
      'candidate-records',
      'targetPrototype',
      moved.candidateIDs,
      input.originPrototypeID,
    )
    await validateMoveIDs(
      req.payload,
      req,
      'media',
      'prototype',
      moved.mediaIDs,
      input.originPrototypeID,
    )
    await validateSplitClosure(req.payload, req, moved, input.originPrototypeID)
    const newPrototype = await req.payload.create({
      collection: 'figure-prototypes',
      data: { ...input.newPrototype, mainImage: null, publicationStatus: 'draft' },
      draft: true,
      overrideAccess: true,
      req,
    })

    await updateIDs(req.payload, req, 'figure-versions', moved.versionIDs, {
      prototype: newPrototype.id,
    })
    await updateIDs(req.payload, req, 'source-records', moved.sourceIDs, {
      prototype: newPrototype.id,
    })
    await updateIDs(req.payload, req, 'candidate-records', moved.candidateIDs, {
      targetPrototype: newPrototype.id,
    })
    await updateIDs(req.payload, req, 'media', moved.mediaIDs, { prototype: newPrototype.id })

    return createOperationLog(req, {
      afterState: { moved, newPrototypeID: newPrototype.id },
      beforeState: { moved, originPrototypeID: input.originPrototypeID },
      inversePayload: { moved, newPrototypeID: newPrototype.id, originPrototypeID: input.originPrototypeID },
      operationType: 'split',
      reason: input.reason,
      relatedRecords: {
        newPrototypeID: newPrototype.id,
        originPrototypeID: input.originPrototypeID,
      },
    })
  })

export const undoLastMergeOrSplit = async (req: PayloadRequest, reason: string) =>
  withinPayloadTransaction(req, async () => {
    const result = await req.payload.find({
      collection: 'operation-logs',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      sort: '-createdAt',
      where: {
        and: [
          { operationType: { in: ['merge', 'split'] } },
          { undone: { equals: false } },
        ],
      },
    })
    const original = result.docs[0]
    if (!original) throw new Error('No merge or split operation is available to undo.')
    const inverse = original.inversePayload as
      | {
          mergedInto?: null | RecordID
          mergedPrototypeID: RecordID
          mergedPublicationStatus: 'draft' | 'hidden' | 'merged' | 'published'
          moved: RelationshipSnapshot
          retainedCharacterIDs: RecordID[]
          retainedPrototypeID: RecordID
        }
      | {
          moved: RelationshipSnapshot
          newPrototypeID: RecordID
          originPrototypeID: RecordID
        }

    if (original.operationType === 'merge' && 'mergedPrototypeID' in inverse) {
      await updateIDs(req.payload, req, 'figure-versions', inverse.moved.versionIDs, {
        prototype: inverse.mergedPrototypeID,
      })
      await updateIDs(req.payload, req, 'source-records', inverse.moved.sourceIDs, {
        prototype: inverse.mergedPrototypeID,
      })
      await updateIDs(req.payload, req, 'candidate-records', inverse.moved.candidateIDs, {
        targetPrototype: inverse.mergedPrototypeID,
      })
      await updateIDs(req.payload, req, 'media', inverse.moved.mediaIDs, {
        prototype: inverse.mergedPrototypeID,
      })
      await req.payload.update({
        collection: 'figure-prototypes',
        data: {
          mergedInto: inverse.mergedInto ?? null,
          publicationStatus: inverse.mergedPublicationStatus,
        },
        id: inverse.mergedPrototypeID,
        overrideAccess: true,
        req,
      })
      await req.payload.update({
        collection: 'figure-prototypes',
        data: { characters: inverse.retainedCharacterIDs },
        id: inverse.retainedPrototypeID,
        overrideAccess: true,
        req,
      })
    } else if ('newPrototypeID' in inverse) {
      await updateIDs(req.payload, req, 'figure-versions', inverse.moved.versionIDs, {
        prototype: inverse.originPrototypeID,
      })
      await updateIDs(req.payload, req, 'source-records', inverse.moved.sourceIDs, {
        prototype: inverse.originPrototypeID,
      })
      await updateIDs(req.payload, req, 'candidate-records', inverse.moved.candidateIDs, {
        targetPrototype: inverse.originPrototypeID,
      })
      await updateIDs(req.payload, req, 'media', inverse.moved.mediaIDs, {
        prototype: inverse.originPrototypeID,
      })
      await req.payload.update({
        collection: 'figure-prototypes',
        data: { mergedInto: inverse.originPrototypeID, publicationStatus: 'merged' },
        id: inverse.newPrototypeID,
        overrideAccess: true,
        req,
      })
    }

    await req.payload.update({
      collection: 'operation-logs',
      data: { undone: true },
      id: original.id,
      overrideAccess: true,
      req,
    })
    return createOperationLog(req, {
      afterState: { restored: inverse },
      beforeState: { originalOperationID: original.id },
      operationType: original.operationType === 'merge' ? 'undo_merge' : 'undo_split',
      reason,
      relatedRecords: { originalOperationID: original.id },
    })
  })
