import type { Endpoint, PayloadRequest } from 'payload'

import { withinPayloadTransaction } from '@/domain/payloadDomainService'
import {
  createFormalTargetForReview,
  updateSystemSettings,
  validateAndAdvanceReviewWorkItem,
} from '@/domain/val02bDomainService'
import { requireAdmin } from '@/security/roles'

type ReviewBody = {
  action:
    | 'accept-field'
    | 'attach-version'
    | 'create-manufacturer'
    | 'create-prototype'
    | 'defer'
    | 'ignore'
    | 'reject-field'
    | 'set-manufacturer-status'
    | 'set-prototype-publication'
    | 'select-main-image'
    | 'update-settings'
  candidateID?: number | string
  expectedVersion?: number | string
  field?: string
  manufacturerID?: number | string
  manufacturerStatus?: 'active' | 'draft' | 'hidden'
  mediaID?: number | string
  newPrototype?: Record<string, unknown>
  newManufacturerName?: string
  prototypeID?: number | string
  publicationStatus?: 'draft' | 'hidden' | 'published'
  reason?: string
  settings?: {
    galleryPageSize?: number
    publicReadEnabled?: boolean
    showAdultImages?: boolean
  }
  softDeleted?: boolean
  value?: unknown
  versionID?: number | string
  workItemID?: number | string
}

const requiredID = (value: unknown, label: string): number => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  throw new Error(`${label} is required and must be a numeric Payload ID.`)
}

const relationID = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  if (value && typeof value === 'object' && 'id' in value) {
    return relationID((value as { id: unknown }).id)
  }
  return undefined
}

const authorizeReviewAction = async (
  req: PayloadRequest,
  body: ReviewBody,
  targetID?: number,
) =>
  validateAndAdvanceReviewWorkItem(req, {
    candidateID: requiredID(body.candidateID, 'candidateID'),
    expectedVersion: requiredID(body.expectedVersion, 'expectedVersion'),
    reason: body.reason,
    targetID,
    workItemID: requiredID(body.workItemID, 'workItemID'),
  })

const logReviewAction = async (
  req: PayloadRequest,
  body: ReviewBody,
  beforeState: Record<string, unknown>,
  afterState: Record<string, unknown>,
) => {
  if (req.context?.testFailBeforeReviewOperationLog === true) {
    throw new Error('Injected review failure before OperationLog.')
  }
  const payload = req.payload as any
  const user = req.user as { email?: string; id?: number | string }
  const typeMap: Record<string, string> = {
    'accept-field': 'accept_field',
    'attach-version': 'attach_version',
    'create-manufacturer': 'create_manufacturer',
    'create-prototype': 'create_prototype',
    defer: 'defer_candidate',
    ignore: 'ignore_candidate',
    'reject-field': 'reject_field',
    'set-manufacturer-status': 'set_manufacturer_status',
    'set-prototype-publication': 'set_prototype_publication',
    'select-main-image': 'select_main_image',
    'update-settings': 'update_settings',
  }
  return payload.create({
    collection: 'operation-logs',
    data: {
      actor: user.id,
      actorLabel: user.email ?? `user:${user.id}`,
      afterState,
      beforeState,
      operationType: typeMap[body.action],
      reason: body.reason?.trim() || `Admin candidate review: ${body.action}`,
      relatedRecords: {
        candidateID: body.candidateID,
        manufacturerID: body.manufacturerID,
        mediaID: body.mediaID,
        prototypeID: body.prototypeID,
      },
      undone: false,
    },
    overrideAccess: true,
    req,
  })
}

const setManufacturerStatus = async (req: PayloadRequest, body: ReviewBody) => {
  const manufacturerID = requiredID(body.manufacturerID, 'manufacturerID')
  const status = body.manufacturerStatus
  if (!status || !['active', 'draft', 'hidden'].includes(status)) {
    throw new Error('manufacturerStatus must be active, draft, or hidden.')
  }
  if (!body.reason?.trim()) throw new Error('A reason is required to change manufacturer status.')

  return withinPayloadTransaction(req, async () => {
    await authorizeReviewAction(req, body)
    const payload = req.payload as any
    const before = await payload.findByID({
      collection: 'manufacturers',
      depth: 0,
      id: manufacturerID,
      overrideAccess: true,
      req,
    })
    const updated = await payload.update({
      collection: 'manufacturers',
      data: { status },
      draft: status === 'draft',
      id: manufacturerID,
      overrideAccess: true,
      req,
    })
    await logReviewAction(
      req,
      body,
      { manufacturerID, status: before.status },
      { manufacturerID, status: updated.status },
    )
    return updated
  })
}

const setPrototypePublication = async (req: PayloadRequest, body: ReviewBody) => {
  const prototypeID = requiredID(body.prototypeID, 'prototypeID')
  const status = body.publicationStatus
  if (!status || !['draft', 'hidden', 'published'].includes(status)) {
    throw new Error('publicationStatus must be draft, hidden, or published.')
  }
  if (body.softDeleted !== undefined && typeof body.softDeleted !== 'boolean') {
    throw new Error('softDeleted must be a boolean when supplied.')
  }
  if (!body.reason?.trim()) throw new Error('A reason is required to change publication state.')

  return withinPayloadTransaction(req, async () => {
    await authorizeReviewAction(req, body, prototypeID)
    const payload = req.payload as any
    const before = await payload.findByID({
      collection: 'figure-prototypes',
      depth: 1,
      id: prototypeID,
      overrideAccess: true,
      req,
    })
    if (status === 'published') {
      if (!relationID(before.mainImage)) {
        throw new Error('A prototype must have a manually selected local main image before publication.')
      }
      const manufacturer = before.manufacturer
      const manufacturerStatus =
        manufacturer && typeof manufacturer === 'object' ? manufacturer.status : undefined
      if (manufacturerStatus !== 'active') {
        throw new Error('A prototype manufacturer must be active before publication.')
      }
    }
    const data: Record<string, unknown> = { publicationStatus: status }
    if (body.softDeleted !== undefined) data.softDeleted = body.softDeleted
    const updated = await payload.update({
      collection: 'figure-prototypes',
      data,
      draft: status === 'draft',
      id: prototypeID,
      overrideAccess: true,
      req,
    })
    await logReviewAction(
      req,
      body,
      {
        prototypeID,
        publicationStatus: before.publicationStatus,
        softDeleted: before.softDeleted,
      },
      {
        prototypeID,
        publicationStatus: updated.publicationStatus,
        softDeleted: updated.softDeleted,
      },
    )
    return updated
  })
}

const updateSettings = async (req: PayloadRequest, body: ReviewBody) => {
  if (!body.settings) throw new Error('settings is required.')
  return updateSystemSettings(req, {
    reason: body.reason?.trim() ?? '',
    settings: body.settings,
  })
}

const createDraftManufacturer = async (req: PayloadRequest, body: ReviewBody) => {
  const name = body.newManufacturerName?.trim()
  if (!name) throw new Error('newManufacturerName is required.')
  return withinPayloadTransaction(req, async () => {
    await authorizeReviewAction(req, body)
    const manufacturer = await (req.payload as any).create({
      collection: 'manufacturers',
      data: { canonicalName: name, status: 'draft' },
      draft: true,
      overrideAccess: true,
      req,
    })
    body.manufacturerID = manufacturer.id
    await logReviewAction(
      req,
      body,
      { manufacturer: null },
      { manufacturer: manufacturer.id, status: manufacturer.status },
    )
    return manufacturer
  })
}

const reviewCandidate = async (req: PayloadRequest, body: ReviewBody) => {
  const payload = req.payload as any
  const candidateID = requiredID(body.candidateID, 'candidateID')
  const candidate = await payload.findByID({
    collection: 'candidate-records',
    depth: 0,
    id: candidateID,
    overrideAccess: true,
    req,
  })

  if (body.action === 'defer' || body.action === 'ignore') {
    if (!body.reason?.trim()) throw new Error('A reason is required to defer or ignore a candidate.')
    await authorizeReviewAction(req, body)
    const updated = await payload.update({
      collection: 'candidate-records',
      data: { reason: body.reason, status: body.action === 'defer' ? 'deferred' : 'ignored' },
      id: candidateID,
      overrideAccess: true,
      req,
    })
    await logReviewAction(req, body, { reason: candidate.reason, status: candidate.status }, {
      reason: updated.reason,
      status: updated.status,
    })
    return updated
  }

  if (body.action === 'accept-field' || body.action === 'reject-field') {
    if (!body.field) throw new Error('field is required.')
    const targetField = body.action === 'accept-field' ? 'acceptedFields' : 'rejectedFields'
    const current = (candidate[targetField] as Record<string, unknown> | undefined) ?? {}
    const next = { ...current, [body.field]: body.value }
    if (body.action === 'reject-field') {
      await authorizeReviewAction(req, body)
      const updated = await payload.update({
        collection: 'candidate-records',
        data: { [targetField]: next },
        id: candidateID,
        overrideAccess: true,
        req,
      })
      await logReviewAction(req, body, { [targetField]: current }, { [targetField]: next })
      return updated
    }

    const prototypeID =
      body.prototypeID ??
      (typeof candidate.targetPrototype === 'object'
        ? candidate.targetPrototype.id
        : candidate.targetPrototype)
    requiredID(prototypeID, 'prototypeID')
    const prototypeFieldMap: Record<string, { field: string; map?: (value: unknown) => unknown }> = {
      category: {
        field: 'figureType',
        map: (value) => (String(value).includes('景品') ? 'prize' : 'scale'),
      },
      scale: { field: 'scale' },
      title: { field: 'title' },
    }
    const mapping = prototypeFieldMap[body.field]
    if (!mapping) throw new Error(`Field ${body.field} is not allowed to mutate FigurePrototype.`)
    const prototype = await payload.findByID({
      collection: 'figure-prototypes',
      depth: 0,
      id: prototypeID!,
      overrideAccess: true,
      req,
    })
    const mappedValue = mapping.map ? mapping.map(body.value) : body.value
    return withinPayloadTransaction(req, async () => {
      await authorizeReviewAction(req, body, requiredID(prototypeID, 'prototypeID'))
      const updated = await payload.update({
        collection: 'candidate-records',
        data: { acceptedFields: next },
        id: candidateID,
        overrideAccess: true,
        req,
      })
      await payload.update({
        collection: 'figure-prototypes',
        data: { [mapping.field]: mappedValue },
        id: prototypeID!,
        overrideAccess: true,
        req,
      })
      body.prototypeID = prototypeID!
      await logReviewAction(
        req,
        body,
        { [mapping.field]: prototype[mapping.field], [targetField]: current },
        { [mapping.field]: mappedValue, [targetField]: next },
      )
      return updated
    })
  }

  if (body.action === 'create-prototype') {
    const created = await createFormalTargetForReview(req, {
      candidateID,
      expectedVersion: requiredID(body.expectedVersion, 'expectedVersion'),
      newPrototype: {
        ...(body.newPrototype ?? {}),
        title: body.newPrototype?.title ?? candidate.rawTitle,
      },
      reason: body.reason?.trim() ?? '',
      workItemID: requiredID(body.workItemID, 'workItemID'),
    })
    body.prototypeID = created.prototype.id
    return created
  }

  if (body.action === 'attach-version') {
    const prototypeID = requiredID(body.prototypeID, 'prototypeID')
    const versionID = requiredID(body.versionID, 'versionID')
    const version = await payload.findByID({
      collection: 'figure-versions',
      depth: 0,
      id: versionID,
      overrideAccess: true,
      req,
    })
    const versionPrototypeID =
      typeof version.prototype === 'object' ? version.prototype.id : version.prototype
    if (String(versionPrototypeID) !== String(prototypeID)) {
      throw new Error('The selected version does not belong to the selected prototype.')
    }
    await authorizeReviewAction(req, body, prototypeID)
    const updated = await payload.update({
      collection: 'candidate-records',
      data: { status: 'merged', targetPrototype: prototypeID, targetVersion: versionID },
      id: candidateID,
      overrideAccess: true,
      req,
    })
    await logReviewAction(req, body, { targetVersion: null }, { targetVersion: versionID })
    return updated
  }

  throw new Error(`Unsupported candidate action: ${body.action}`)
}

const selectMainImage = async (req: PayloadRequest, body: ReviewBody) => {
  const payload = req.payload as any
  const candidateID = requiredID(body.candidateID, 'candidateID')
  const mediaID = requiredID(body.mediaID, 'mediaID')
  const prototypeID = requiredID(body.prototypeID, 'prototypeID')
  return withinPayloadTransaction(req, async () => {
    await authorizeReviewAction(req, body, prototypeID)
    const [candidate, media, prototype] = await Promise.all([
    payload.findByID({
      collection: 'candidate-records',
      depth: 0,
      id: candidateID,
      overrideAccess: true,
      req,
    }),
    payload.findByID({
      collection: 'media',
      depth: 0,
      id: mediaID,
      overrideAccess: true,
      req,
    }),
    payload.findByID({
      collection: 'figure-prototypes',
      depth: 0,
      id: prototypeID,
      overrideAccess: true,
      req,
    }),
    ])
    if (relationID(candidate.targetPrototype) !== prototypeID) {
      throw new Error('The candidate is not matched to the selected prototype.')
    }
    const candidateImageIDs = (candidate.images ?? [])
      .map(relationID)
      .filter((id: number | undefined): id is number => id !== undefined)
    if (!candidateImageIDs.includes(mediaID) || relationID(media.candidate) !== candidateID) {
      throw new Error('The selected media does not belong to the reviewed candidate.')
    }
    const mediaPrototypeID = relationID(media.prototype)
    if (mediaPrototypeID !== undefined && mediaPrototypeID !== prototypeID) {
      throw new Error('The selected media already belongs to another formal prototype.')
    }
    if (!media.storageKey || !media.filename || !media.url) {
      throw new Error('The selected media must have a local file and stable storage key.')
    }
    const previousMainID = relationID(prototype.mainImage)
    if (previousMainID && String(previousMainID) !== String(mediaID)) {
      await payload.update({
        collection: 'media',
        data: { selectedAsMain: false },
        id: previousMainID,
        overrideAccess: true,
        req,
      })
    }
    await payload.update({
      collection: 'media',
      data: { candidateOnly: false, prototype: prototypeID, selectedAsMain: true },
      id: mediaID,
      overrideAccess: true,
      req,
    })
    req.context = { ...req.context, manualMainImageReview: true }
    let updated: any
    try {
      updated = await payload.update({
        collection: 'figure-prototypes',
        data: { mainImage: mediaID },
        id: prototypeID,
        overrideAccess: true,
        req,
      })
    } finally {
      delete req.context.manualMainImageReview
    }
    await logReviewAction(
      req,
      body,
      { mainImage: previousMainID ?? null },
      { mainImage: mediaID },
    )
    return updated
  })
}

export const candidateReviewEndpoint: Endpoint = {
  path: '/review-action',
  method: 'post',
  handler: async (req) => {
    try {
      requireAdmin(req)
      if (!req.json) throw new Error('A JSON request body is required.')
      const body = (await req.json()) as ReviewBody
      if (!body.action) throw new Error('action is required.')

      let result: unknown
      if (
        body.action === 'defer' ||
        body.action === 'ignore' ||
        body.action === 'accept-field' ||
        body.action === 'reject-field' ||
        body.action === 'create-prototype' ||
        body.action === 'attach-version'
      ) {
        result = await withinPayloadTransaction(req, () => reviewCandidate(req, body))
      } else if (body.action === 'create-manufacturer') {
        result = await createDraftManufacturer(req, body)
      } else if (body.action === 'set-manufacturer-status') {
        result = await setManufacturerStatus(req, body)
      } else if (body.action === 'set-prototype-publication') {
        result = await setPrototypePublication(req, body)
      } else if (body.action === 'update-settings') {
        result = await updateSettings(req, body)
      } else if (body.action === 'select-main-image') {
        result = await selectMainImage(req, body)
      } else {
        throw new Error(`Unsupported action: ${body.action}`)
      }
      const workItemVersion = body.workItemID
        ? Number((await (req.payload as any).findByID({
            collection: 'review-work-items',
            depth: 0,
            id: requiredID(body.workItemID, 'workItemID'),
            overrideAccess: true,
            req,
          })).lockVersion)
        : undefined
      return Response.json({ ok: true, result, workItemVersion })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Review action failed.'
      return Response.json(
        { error: message },
        { status: message.includes('Administrator') ? 403 : message.includes('conflict') ? 409 : 400 },
      )
    }
  },
}
