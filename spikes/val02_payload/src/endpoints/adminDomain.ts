import type { Endpoint, PayloadRequest } from 'payload'

import {
  maintainFormalRecord,
  openReviewWorkItem,
  reopenReviewWorkItem,
  revokeCandidateClient,
  updateSystemSettings,
  validateAndAdvanceReviewWorkItem,
} from '@/domain/val02bDomainService'
import { mergePrototypes, splitPrototype, undoOperationByID } from '@/domain/payloadDomainService'
import { requireAdmin } from '@/security/roles'

type AdminDomainBody = {
  action:
    | 'complete-review'
    | 'maintain-record'
    | 'merge'
    | 'open-review'
    | 'reopen-review'
    | 'revoke-client'
    | 'split'
    | 'undo-operation'
    | 'update-settings'
  allowedTargetIDs?: unknown[]
  candidateID?: unknown
  clientUserID?: unknown
  collection?: string
  data?: Record<string, unknown>
  dependsOn?: unknown[]
  expectedVersion?: unknown
  expectedMergedVersion?: unknown
  expectedOriginVersion?: unknown
  expectedRetainedVersion?: unknown
  id?: unknown
  mergedPrototypeID?: unknown
  newPrototype?: Record<string, unknown>
  operationID?: string
  originPrototypeID?: unknown
  reason?: string
  relationshipIDs?: {
    candidateIDs?: unknown[]
    mediaIDs?: unknown[]
    sourceIDs?: unknown[]
    versionIDs?: unknown[]
  }
  retainedPrototypeID?: unknown
  targetID?: unknown
  settings?: {
    galleryPageSize?: number
    publicReadEnabled?: boolean
    showAdultImages?: boolean
  }
  workItemID?: unknown
}

const requiredID = (value: unknown, label: string): number => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  throw new Error(`${label} must be a numeric Payload ID.`)
}

const requiredVersion = (value: unknown): number => {
  const version = requiredID(value, 'expectedVersion')
  if (version < 1) throw new Error('expectedVersion must be positive.')
  return version
}

export const adminDomainEndpoint: Endpoint = {
  path: '/domain-action',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    try {
      requireAdmin(req)
      if (!req.json) throw new Error('A JSON request body is required.')
      const body = (await req.json()) as AdminDomainBody
      const reason = body.reason?.trim()
      if (!reason) throw new Error('An audit reason is required.')
      let result: unknown
      if (body.action === 'open-review') {
        result = await openReviewWorkItem(req, {
          allowedTargetIDs: (body.allowedTargetIDs ?? []).map((value) => requiredID(value, 'allowedTargetID')),
          candidateID: requiredID(body.candidateID, 'candidateID'),
          reason,
        })
      } else if (body.action === 'reopen-review') {
        result = await reopenReviewWorkItem(req, {
          expectedVersion: requiredVersion(body.expectedVersion),
          reason,
          workItemID: requiredID(body.workItemID, 'workItemID'),
        })
      } else if (body.action === 'revoke-client') {
        result = await revokeCandidateClient(req, {
          clientUserID: requiredID(body.clientUserID, 'clientUserID'),
          reason,
        })
      } else if (body.action === 'complete-review') {
        result = await validateAndAdvanceReviewWorkItem(req, {
          candidateID: requiredID(body.candidateID, 'candidateID'),
          complete: true,
          expectedVersion: requiredVersion(body.expectedVersion),
          reason,
          targetID: requiredID(body.targetID, 'targetID'),
          workItemID: requiredID(body.workItemID, 'workItemID'),
        })
      } else if (body.action === 'merge') {
        result = await mergePrototypes(req, {
          dependsOn: (body.dependsOn ?? []).map((value) => String(value)),
          expectedMergedVersion: requiredVersion(body.expectedMergedVersion),
          expectedRetainedVersion: requiredVersion(body.expectedRetainedVersion),
          mergedPrototypeID: requiredID(body.mergedPrototypeID, 'mergedPrototypeID'),
          reason,
          retainedPrototypeID: requiredID(body.retainedPrototypeID, 'retainedPrototypeID'),
        })
      } else if (body.action === 'split') {
        if (!body.newPrototype) throw new Error('newPrototype is required.')
        const ids = body.relationshipIDs ?? {}
        const mapIDs = (values: unknown[] | undefined, label: string) =>
          (values ?? []).map((value) => requiredID(value, label))
        result = await splitPrototype(req, {
          candidateIDs: mapIDs(ids.candidateIDs, 'candidateID'),
          dependsOn: (body.dependsOn ?? []).map((value) => String(value)),
          expectedOriginVersion: requiredVersion(body.expectedOriginVersion),
          mediaIDs: mapIDs(ids.mediaIDs, 'mediaID'),
          newPrototype: body.newPrototype,
          originPrototypeID: requiredID(body.originPrototypeID, 'originPrototypeID'),
          reason,
          sourceIDs: mapIDs(ids.sourceIDs, 'sourceID'),
          versionIDs: mapIDs(ids.versionIDs, 'versionID'),
        })
      } else if (body.action === 'undo-operation') {
        if (!body.operationID?.trim()) throw new Error('operationID is required.')
        result = await undoOperationByID(req, body.operationID.trim(), reason)
      } else if (body.action === 'maintain-record') {
        if (!body.collection || !body.data) throw new Error('collection and data are required.')
        result = await maintainFormalRecord(req, {
          collection: body.collection,
          data: body.data,
          expectedVersion:
            body.collection === 'figure-prototypes' && body.id !== undefined
              ? requiredVersion(body.expectedVersion)
              : undefined,
          id: body.id === undefined ? undefined : requiredID(body.id, 'id'),
          reason,
        })
      } else if (body.action === 'update-settings') {
        if (!body.settings) throw new Error('settings are required.')
        result = await updateSystemSettings(req, { reason, settings: body.settings })
      } else {
        throw new Error('Unsupported administrator domain action.')
      }
      return Response.json({ ok: true, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Administrator domain action failed.'
      return Response.json(
        { error: message },
        { status: message.includes('Administrator') ? 403 : message.includes('conflict') ? 409 : 400 },
      )
    }
  },
}
