import { randomUUID } from 'node:crypto'
import type { PayloadRequest } from 'payload'

import { buildDomainScope, withinPayloadTransaction } from '@/domain/payloadDomainService'
import { requireAdmin } from '@/security/roles'

type RecordID = number

const relationID = (value: unknown): RecordID | undefined => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  if (value && typeof value === 'object' && 'id' in value) return relationID((value as { id: unknown }).id)
  return undefined
}

const relationIDs = (value: unknown): RecordID[] =>
  (Array.isArray(value) ? value : []).map(relationID).filter((id): id is number => id !== undefined)

const actor = (req: PayloadRequest) => {
  const user = req.user as { email?: string; id?: number | string }
  return { actor: relationID(user), actorLabel: user?.email ?? `user:${user?.id}` }
}

const withinAdminTransaction = <T>(req: PayloadRequest, operation: () => Promise<T>): Promise<T> => {
  requireAdmin(req)
  return withinPayloadTransaction(req, operation)
}

export const writeVal02bOperationLog = async (
  req: PayloadRequest,
  input: {
    afterState: Record<string, unknown>
    beforeState: Record<string, unknown>
    dependsOn?: string[]
    inversePayload?: Record<string, unknown>
    operationType: string
    reason: string
    relatedRecords: Record<string, unknown>
    scope?: Record<string, unknown>
  },
) =>
  {
    requireAdmin(req)
    return (req.payload as any).create({
      collection: 'operation-logs',
      data: {
        ...actor(req),
        ...input,
        dependsOn: input.dependsOn ?? [],
        operationID: randomUUID(),
        operationVersion: 1,
        scope: buildDomainScope(input.scope),
        undone: false,
      },
      overrideAccess: true,
      req,
    })
  }

export const openReviewWorkItem = async (
  req: PayloadRequest,
  input: { allowedTargetIDs?: number[]; candidateID: number; reason: string },
) =>
  withinAdminTransaction(req, async () => {
    const payload = req.payload as any
    await payload.findByID({ collection: 'candidate-records', id: input.candidateID, overrideAccess: true, req })
    for (const id of input.allowedTargetIDs ?? []) {
      await payload.findByID({ collection: 'figure-prototypes', id, overrideAccess: true, req })
    }
    const workItem = await payload.create({
      collection: 'review-work-items',
      data: {
        allowedTargets: input.allowedTargetIDs ?? [],
        candidate: input.candidateID,
        lockVersion: 1,
        reviewer: relationID(req.user),
        startedAt: new Date().toISOString(),
        status: 'open',
      },
      overrideAccess: true,
      req,
    })
    await writeVal02bOperationLog(req, {
      afterState: { lockVersion: 1, status: 'open' },
      beforeState: { workItem: null },
      operationType: 'review_work_item_opened',
      reason: input.reason,
      relatedRecords: { candidateID: input.candidateID, reviewWorkItemID: workItem.id },
      scope: { candidateIDs: [input.candidateID], reviewWorkItemIDs: [workItem.id] },
    })
    return workItem
  })

export const reopenReviewWorkItem = async (
  req: PayloadRequest,
  input: { expectedVersion: number; reason: string; workItemID: number },
) =>
  withinAdminTransaction(req, async () => {
    const payload = req.payload as any
    const before = await payload.findByID({
      collection: 'review-work-items',
      depth: 0,
      id: input.workItemID,
      overrideAccess: true,
      req,
    })
    if (before.status !== 'completed') throw new Error('Only a completed review work item can be reopened.')
    if (before.lockVersion !== input.expectedVersion) throw new Error('Review work item version conflict.')
    const updated = await payload.update({
      collection: 'review-work-items',
      data: {
        completedAt: null,
        decisionReason: input.reason,
        lockVersion: before.lockVersion + 1,
        reviewer: relationID(req.user),
        startedAt: new Date().toISOString(),
        status: 'open',
      },
      id: before.id,
      overrideAccess: true,
      req,
    })
    await writeVal02bOperationLog(req, {
      afterState: { lockVersion: updated.lockVersion, status: updated.status },
      beforeState: { lockVersion: before.lockVersion, status: before.status },
      operationType: 'review_work_item_reopened',
      reason: input.reason,
      relatedRecords: { reviewWorkItemID: before.id },
      scope: { reviewWorkItemIDs: [before.id] },
    })
    return updated
  })

export const validateAndAdvanceReviewWorkItem = async (
  req: PayloadRequest,
  input: {
    candidateID: number
    complete?: boolean
    expectedVersion: number
    reason?: string
    targetID?: number
    workItemID: number
  },
) => {
  return withinAdminTransaction(req, async () => {
    const payload = req.payload as any
    const before = await payload.findByID({
      collection: 'review-work-items',
      depth: 0,
      id: input.workItemID,
      overrideAccess: true,
      req,
    })
    // Version is checked before reassignment so two distinct administrators
    // who loaded the same item receive a deterministic HTTP 409 on the later
    // submit instead of silently overwriting each other.
    if (before.lockVersion !== input.expectedVersion) throw new Error('Review work item version conflict.')
    if (before.status !== 'open') throw new Error('Completed review work items cannot be modified without reopen.')
    if (relationID(before.candidate) !== input.candidateID) throw new Error('Review work item candidate mismatch.')
    const allowedTargets = relationIDs(before.allowedTargets)
    if (input.targetID !== undefined && !allowedTargets.includes(input.targetID)) {
      throw new Error('Review target is outside the work item allowed target set.')
    }
    const updated = await payload.update({
      collection: 'review-work-items',
      data: {
        allowedTargets,
        completedAt: input.complete ? new Date().toISOString() : before.completedAt,
        decisionReason: input.reason ?? before.decisionReason,
        lockVersion: before.lockVersion + 1,
        reviewer: relationID(req.user),
        status: input.complete ? 'completed' : 'open',
      },
      id: before.id,
      overrideAccess: true,
      req,
    })
    if (input.complete) {
      await writeVal02bOperationLog(req, {
        afterState: {
          decisionReason: updated.decisionReason,
          lockVersion: updated.lockVersion,
          status: updated.status,
          targetID: input.targetID ?? null,
        },
        beforeState: { lockVersion: before.lockVersion, status: before.status },
        operationType: 'review_work_item_completed',
        reason: input.reason ?? 'Complete review work item',
        relatedRecords: {
          candidateID: input.candidateID,
          reviewWorkItemID: before.id,
          targetID: input.targetID ?? null,
        },
        scope: { candidateIDs: [input.candidateID], reviewWorkItemIDs: [before.id] },
      })
    }
    return updated
  })
}

const reviewPrototypeFields = new Set([
  'characters',
  'costumeText',
  'figureType',
  'isAdult',
  'isGroup',
  'manufacturer',
  'scale',
  'title',
  'work',
])

/**
 * The only way a review work item can gain a target: create that target in the
 * same transaction. Callers cannot nominate a pre-existing arbitrary ID.
 */
export const createFormalTargetForReview = async (
  req: PayloadRequest,
  input: {
    candidateID: number
    expectedVersion: number
    newPrototype: Record<string, unknown>
    reason: string
    workItemID: number
  },
) =>
  withinAdminTransaction(req, async () => {
    const payload = req.payload as any
    const before = await payload.findByID({
      collection: 'review-work-items',
      depth: 0,
      id: input.workItemID,
      overrideAccess: true,
      req,
    })
    if (before.lockVersion !== input.expectedVersion) throw new Error('Review work item version conflict.')
    if (before.status !== 'open') throw new Error('Completed review work items cannot be modified without reopen.')
    if (relationID(before.candidate) !== input.candidateID) throw new Error('Review work item candidate mismatch.')
    const keys = Object.keys(input.newPrototype)
    if (!keys.length || keys.some((key) => !reviewPrototypeFields.has(key))) {
      throw new Error('New review target contains a field outside the controlled create allowlist.')
    }
    if (!input.reason.trim()) throw new Error('A review target creation reason is required.')

    const prototype = await payload.create({
      collection: 'figure-prototypes',
      data: {
        ...input.newPrototype,
        lockVersion: 1,
        mainImage: null,
        publicationStatus: 'draft',
      },
      draft: true,
      overrideAccess: true,
      req,
    })
    const allowedTargets = [...new Set([...relationIDs(before.allowedTargets), prototype.id])]
    const workItem = await payload.update({
      collection: 'review-work-items',
      data: {
        allowedTargets,
        decisionReason: input.reason,
        lockVersion: before.lockVersion + 1,
        reviewer: relationID(req.user),
      },
      id: before.id,
      overrideAccess: true,
      req,
    })
    const candidate = await payload.update({
      collection: 'candidate-records',
      data: { status: 'accepted', targetPrototype: prototype.id },
      id: input.candidateID,
      overrideAccess: true,
      req,
    })
    await writeVal02bOperationLog(req, {
      afterState: { allowedTargets, prototypeID: prototype.id, workItemVersion: workItem.lockVersion },
      beforeState: { allowedTargets: relationIDs(before.allowedTargets), prototypeID: null, workItemVersion: before.lockVersion },
      operationType: 'create_prototype',
      reason: input.reason,
      relatedRecords: {
        candidateID: input.candidateID,
        prototypeID: prototype.id,
        reviewWorkItemID: input.workItemID,
      },
      scope: {
        candidateIDs: [input.candidateID],
        prototypeIDs: [prototype.id],
        reviewWorkItemIDs: [input.workItemID],
      },
    })
    return { candidate, prototype, workItem }
  })

export const updateSystemSettings = async (
  req: PayloadRequest,
  input: {
    reason: string
    settings: {
      galleryPageSize?: number
      publicReadEnabled?: boolean
      showAdultImages?: boolean
    }
  },
) =>
  withinAdminTransaction(req, async () => {
    const allowed = new Set(['galleryPageSize', 'publicReadEnabled', 'showAdultImages'])
    const keys = Object.keys(input.settings)
    if (!keys.length || keys.some((key) => !allowed.has(key))) {
      throw new Error('Settings contain a field outside the audited allowlist.')
    }
    if (
      input.settings.galleryPageSize !== undefined &&
      (!Number.isInteger(input.settings.galleryPageSize) ||
        input.settings.galleryPageSize < 1 ||
        input.settings.galleryPageSize > 100)
    ) {
      throw new Error('galleryPageSize must be an integer from 1 to 100.')
    }
    for (const key of ['publicReadEnabled', 'showAdultImages'] as const) {
      if (input.settings[key] !== undefined && typeof input.settings[key] !== 'boolean') {
        throw new Error(`${key} must be a boolean.`)
      }
    }
    if (!input.reason.trim()) throw new Error('A settings audit reason is required.')

    const payload = req.payload as any
    const before = await payload.findGlobal({ overrideAccess: true, req, slug: 'system-settings' })
    const updated = await payload.updateGlobal({
      data: input.settings,
      overrideAccess: true,
      req,
      slug: 'system-settings',
    })
    await writeVal02bOperationLog(req, {
      afterState: Object.fromEntries(keys.map((key) => [key, updated[key]])),
      beforeState: Object.fromEntries(keys.map((key) => [key, before[key]])),
      operationType: 'update_settings',
      reason: input.reason,
      relatedRecords: { global: 'system-settings' },
      scope: { globals: ['system-settings'] },
    })
    return updated
  })

const allowedFields: Record<string, ReadonlySet<string>> = {
  works: new Set(['aliases', 'name', 'originalName']),
  characters: new Set(['aliases', 'displayName', 'nameEn', 'nameJa', 'nameZh', 'softDeleted', 'status', 'work']),
  manufacturers: new Set(['aliases', 'canonicalName', 'status']),
  'figure-prototypes': new Set(['characters', 'costumeText', 'figureType', 'isAdult', 'isGroup', 'manufacturer', 'publicationStatus', 'scale', 'softDeleted', 'title', 'work']),
  'figure-versions': new Set(['kind', 'name', 'prototype']),
  'source-records': new Set(['deletedAt', 'invalidated', 'lastSyncedAt', 'status']),
  'candidate-records': new Set(['deletedAt', 'reason', 'status']),
  media: new Set(['isAdult', 'presentInLatestSource']),
}

export const maintainFormalRecord = async (
  req: PayloadRequest,
  input: {
    collection: keyof typeof allowedFields
    data: Record<string, unknown>
    expectedVersion?: number
    id?: number
    reason: string
  },
) =>
  withinAdminTransaction(req, async () => {
    const allowed = allowedFields[input.collection]
    if (!allowed) throw new Error('Unsupported formal collection.')
    const keys = Object.keys(input.data)
    if (!keys.length || keys.some((key) => !allowed.has(key))) {
      throw new Error('Formal maintenance contains a field outside the audited allowlist.')
    }
    if (!input.reason.trim()) throw new Error('Formal maintenance reason is required.')
    const payload = req.payload as any
    const before = input.id
      ? await payload.findByID({ collection: input.collection, depth: 0, id: input.id, overrideAccess: true, req })
      : null
    const isVersionedPrototype = input.collection === 'figure-prototypes'
    if (isVersionedPrototype && before) {
      if (!Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) {
        throw new Error('expectedVersion is required for FigurePrototype maintenance.')
      }
      if (Number(before.lockVersion) !== input.expectedVersion) {
        throw new Error('FigurePrototype version conflict.')
      }
    } else if (input.expectedVersion !== undefined) {
      throw new Error('expectedVersion is only supported for existing FigurePrototype maintenance.')
    }
    const writeData = isVersionedPrototype
      ? { ...input.data, lockVersion: before ? Number(before.lockVersion) + 1 : 1 }
      : input.data
    const result = input.id
      ? await payload.update({ collection: input.collection, data: writeData, id: input.id, overrideAccess: true, req })
      : await payload.create({ collection: input.collection, data: writeData, overrideAccess: true, req })
    const beforeValues = before
      ? Object.fromEntries(keys.map((key) => [key, before[key]]))
      : undefined
    const afterValues = Object.fromEntries(keys.map((key) => [key, result[key]]))
    if (isVersionedPrototype) {
      if (beforeValues) beforeValues.lockVersion = before.lockVersion
      afterValues.lockVersion = result.lockVersion
    }
    await writeVal02bOperationLog(req, {
      afterState: { id: result.id, values: afterValues },
      beforeState: before ? { id: before.id, values: beforeValues } : { id: null },
      operationType: 'maintain_formal',
      reason: input.reason,
      relatedRecords: { collection: input.collection, id: result.id },
      scope: { collections: [input.collection], recordIDs: [result.id] },
    })
    return result
  })

export const revokeCandidateClient = async (
  req: PayloadRequest,
  input: { clientUserID: number; reason: string },
) =>
  withinAdminTransaction(req, async () => {
    if (!input.reason.trim()) throw new Error('Client revocation reason is required.')
    const payload = req.payload as any
    const before = await payload.findByID({ collection: 'users', id: input.clientUserID, overrideAccess: true, req, showHiddenFields: true })
    if (before.role !== 'candidate-client') throw new Error('Only candidate client credentials can be revoked here.')
    const updated = await payload.update({
      collection: 'users',
      data: { candidateActive: false, enableAPIKey: false },
      id: input.clientUserID,
      overrideAccess: true,
      req,
      showHiddenFields: true,
    })
    await writeVal02bOperationLog(req, {
      afterState: { candidateActive: false, enableAPIKey: false },
      beforeState: { candidateActive: before.candidateActive, enableAPIKey: before.enableAPIKey },
      operationType: 'client_revoked',
      reason: input.reason,
      relatedRecords: { clientUserID: input.clientUserID },
      scope: { clientUserIDs: [input.clientUserID] },
    })
    return updated
  })
