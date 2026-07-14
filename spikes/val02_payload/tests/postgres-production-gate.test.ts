import { randomBytes, randomUUID } from 'node:crypto'
import type { Payload, PayloadRequest } from 'payload'
import { createLocalReq, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  mergePrototypes,
  undoOperationByID,
  withinPayloadTransaction,
} from '@/domain/payloadDomainService'
import {
  maintainFormalRecord,
  openReviewWorkItem,
  validateAndAdvanceReviewWorkItem,
} from '@/domain/val02bDomainService'
import { candidateUpsertEndpoint } from '@/endpoints/candidateUpsert'

type Doc = Record<string, any>

const runPostgresGate = process.env.PAYLOAD_CI_POSTGRES === 'true'
const postgresDescribe = runPostgresGate ? describe.sequential : describe.skip

let payload: Payload
let adminA: Doc
let adminB: Doc
let work: Doc
let character: Doc
let manufacturer: Doc

const relationID = (value: unknown): unknown =>
  value && typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : value

const postgresSQLStates = (error: unknown): string[] => {
  const states = new Set<string>()
  const seen = new Set<object>()
  const pending: unknown[] = [error]
  while (pending.length > 0 && seen.size < 100) {
    const current = pending.pop()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    const record = current as Record<string, unknown>
    for (const key of ['code', 'sqlState', 'sqlstate']) {
      const value = record[key]
      if (typeof value === 'string' && /^[0-9A-Z]{5}$/i.test(value)) {
        states.add(value.toUpperCase())
      }
    }
    for (const key of ['cause', 'driverError', 'error', 'originalError']) {
      if (record[key]) pending.push(record[key])
    }
    if (Array.isArray(record.errors)) pending.push(...record.errors)
  }
  return [...states].sort()
}

const createPrototype = (label: string) =>
  payload.create({
    collection: 'figure-prototypes',
    data: {
      characters: [character.id],
      figureType: 'scale',
      isAdult: false,
      isGroup: false,
      lockVersion: 1,
      manufacturer: manufacturer.id,
      publicationStatus: 'draft',
      softDeleted: false,
      title: `PostgreSQL gate ${label} ${randomUUID()}`,
      work: work.id,
    },
    draft: false,
    overrideAccess: true,
  })

const adminRequest = (user: Doc): Promise<PayloadRequest> =>
  createLocalReq({ user: user as never }, payload)

const jsonRequest = async (
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

const twoPartyBarrier = () => {
  let arrivals = 0
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })

  return async () => {
    arrivals += 1
    if (arrivals === 2) release()
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('PostgreSQL concurrency barrier timed out.')),
        10_000,
      )
      released.then(() => {
        clearTimeout(timeout)
        resolve()
      }, reject)
    })
  }
}

postgresDescribe('Payload PostgreSQL production transaction gate', () => {
  beforeAll(async () => {
    if (process.env.DATABASE_ADAPTER !== 'postgres') {
      throw new Error('PAYLOAD_CI_POSTGRES requires DATABASE_ADAPTER=postgres.')
    }
    if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URI ?? '')) {
      throw new Error('PAYLOAD_CI_POSTGRES requires a PostgreSQL DATABASE_URI.')
    }
    if (!process.env.PAYLOAD_SECRET) {
      throw new Error('PAYLOAD_CI_POSTGRES requires a runtime PAYLOAD_SECRET.')
    }

    const { default: config } = await import('@payload-config')
    payload = await getPayload({ config })
    const marker = randomUUID()
    adminA = await payload.create({
      collection: 'users',
      data: {
        candidateActive: true,
        email: `postgres-admin-a-${marker}@synthetic.invalid`,
        password: randomBytes(24).toString('base64url'),
        role: 'admin',
      },
      overrideAccess: true,
    })
    adminB = await payload.create({
      collection: 'users',
      data: {
        candidateActive: true,
        email: `postgres-admin-b-${marker}@synthetic.invalid`,
        password: randomBytes(24).toString('base64url'),
        role: 'admin',
      },
      overrideAccess: true,
    })
    work = await payload.create({
      collection: 'works',
      data: { name: `PostgreSQL gate work ${marker}` },
      draft: false,
      overrideAccess: true,
    })
    manufacturer = await payload.create({
      collection: 'manufacturers',
      data: { canonicalName: `PostgreSQL gate manufacturer ${marker}`, status: 'draft' },
      draft: false,
      overrideAccess: true,
    })
    character = await payload.create({
      collection: 'characters',
      data: {
        displayName: `PostgreSQL gate character ${marker}`,
        softDeleted: false,
        status: 'active',
        work: work.id,
      },
      draft: false,
      overrideAccess: true,
    })
  }, 120_000)

  afterAll(async () => {
    if (payload) await payload.destroy()
  })

  it('allows exactly one true simultaneous optimistic writer and reports the loser', async () => {
    const retained = await createPrototype('shared retained')
    const mergedA = await createPrototype('writer A')
    const mergedB = await createPrototype('writer B')
    const reqA = await adminRequest(adminA)
    const reqB = await adminRequest(adminB)
    const barrier = twoPartyBarrier()
    const beforeLogs = await payload.count({ collection: 'operation-logs', overrideAccess: true })

    const results = await Promise.allSettled([
      mergePrototypes(
        reqA,
        {
          expectedMergedVersion: 1,
          expectedRetainedVersion: 1,
          mergedPrototypeID: mergedA.id,
          reason: 'PostgreSQL true concurrent writer A',
          retainedPrototypeID: retained.id,
        },
        { afterVersionRead: barrier },
      ),
      mergePrototypes(
        reqB,
        {
          expectedMergedVersion: 1,
          expectedRetainedVersion: 1,
          mergedPrototypeID: mergedB.id,
          reason: 'PostgreSQL true concurrent writer B',
          retainedPrototypeID: retained.id,
        },
        { afterVersionRead: barrier },
      ),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String((rejected[0].reason as Error)?.message ?? rejected[0].reason)).toContain(
      'Concurrent PostgreSQL transaction conflict',
    )

    const [retainedAfter, mergedAAfter, mergedBAfter, afterLogs] = await Promise.all([
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: retained.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: mergedA.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: mergedB.id,
        overrideAccess: true,
      }),
      payload.count({ collection: 'operation-logs', overrideAccess: true }),
    ])
    expect(retainedAfter.lockVersion).toBe(2)
    expect([mergedAAfter.publicationStatus, mergedBAfter.publicationStatus].sort()).toEqual([
      'draft',
      'merged',
    ])
    expect(afterLogs.totalDocs - beforeLogs.totalDocs).toBe(1)
  }, 60_000)

  it('rolls every relationship, version and audit write back after an injected failure', async () => {
    const retained = await createPrototype('rollback retained')
    const merged = await createPrototype('rollback merged')
    const version = await payload.create({
      collection: 'figure-versions',
      data: {
        kind: 'standard',
        name: `PostgreSQL rollback version ${randomUUID()}`,
        prototype: merged.id,
      },
      overrideAccess: true,
    })
    const req = await adminRequest(adminA)
    const beforeLogs = await payload.count({ collection: 'operation-logs', overrideAccess: true })

    await expect(
      mergePrototypes(
        req,
        {
          expectedMergedVersion: 1,
          expectedRetainedVersion: 1,
          mergedPrototypeID: merged.id,
          reason: 'PostgreSQL injected rollback',
          retainedPrototypeID: retained.id,
        },
        {
          afterFirstRelationMove: () => {
            throw new Error('Injected PostgreSQL transaction failure.')
          },
        },
      ),
    ).rejects.toThrow('Injected PostgreSQL transaction failure.')

    const [retainedAfter, mergedAfter, versionAfter, afterLogs] = await Promise.all([
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: retained.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: merged.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-versions',
        depth: 0,
        id: version.id,
        overrideAccess: true,
      }),
      payload.count({ collection: 'operation-logs', overrideAccess: true }),
    ])
    expect(retainedAfter.lockVersion).toBe(1)
    expect(mergedAfter.lockVersion).toBe(1)
    expect(mergedAfter.publicationStatus).toBe('draft')
    expect(mergedAfter.mergedInto).toBeFalsy()
    expect(relationID(versionAfter.prototype)).toBe(merged.id)
    expect(afterLogs.totalDocs).toBe(beforeLogs.totalDocs)
  }, 60_000)

  it('captures SQLSTATE 23505 and rolls the entire transaction back on a real unique index conflict', async () => {
    const marker = randomUUID()
    const duplicateOperationID = `postgres-unique-${marker}`
    const transactionalFixtureID = `postgres-unique-work-${marker}`
    const baseline = await payload.create({
      collection: 'operation-logs',
      data: {
        actor: adminA.id,
        actorLabel: String(adminA.email),
        afterState: { baseline: true },
        beforeState: { baseline: false },
        operationID: duplicateOperationID,
        operationType: 'maintain_formal',
        operationVersion: 1,
        reason: 'PostgreSQL unique-conflict baseline',
        relatedRecords: { marker },
        scope: { marker },
        undone: false,
      },
      draft: false,
      overrideAccess: true,
    })
    const req = await adminRequest(adminA)
    const [beforeLogs, beforeWorks] = await Promise.all([
      payload.count({ collection: 'operation-logs', overrideAccess: true }),
      payload.count({
        collection: 'works',
        overrideAccess: true,
        where: { fixtureID: { equals: transactionalFixtureID } },
      }),
    ])
    expect(beforeWorks.totalDocs).toBe(0)

    let observedError: unknown
    try {
      await withinPayloadTransaction(req, async () => {
        await payload.create({
          collection: 'works',
          data: {
            fixtureID: transactionalFixtureID,
            name: `PostgreSQL unique rollback work ${marker}`,
          },
          draft: false,
          overrideAccess: true,
          req,
        })
        await payload.create({
          collection: 'operation-logs',
          data: {
            actor: adminA.id,
            actorLabel: String(adminA.email),
            afterState: { transaction: 'would-commit' },
            beforeState: { transaction: 'not-started' },
            operationID: `postgres-unique-prior-${marker}`,
            operationType: 'maintain_formal',
            operationVersion: 1,
            reason: 'PostgreSQL unique-conflict prior audit write',
            relatedRecords: { transactionalFixtureID },
            scope: { transactionalFixtureID },
            undone: false,
          },
          draft: false,
          overrideAccess: true,
          req,
        })
        await payload.create({
          collection: 'operation-logs',
          data: {
            actor: adminA.id,
            actorLabel: String(adminA.email),
            afterState: { duplicate: true },
            beforeState: { duplicate: false },
            operationID: duplicateOperationID,
            operationType: 'maintain_formal',
            operationVersion: 1,
            reason: 'PostgreSQL real unique-index conflict',
            relatedRecords: { baselineOperationLogID: baseline.id },
            scope: { marker },
            undone: false,
          },
          draft: false,
          overrideAccess: true,
          req,
        })
      })
    } catch (error) {
      observedError = error
    }

    expect(postgresSQLStates(observedError)).toContain('23505')
    const [afterLogs, afterWorks, baselineAfter] = await Promise.all([
      payload.count({ collection: 'operation-logs', overrideAccess: true }),
      payload.count({
        collection: 'works',
        overrideAccess: true,
        where: { fixtureID: { equals: transactionalFixtureID } },
      }),
      payload.findByID({
        collection: 'operation-logs',
        depth: 0,
        id: baseline.id,
        overrideAccess: true,
      }),
    ])
    expect(afterWorks.totalDocs).toBe(0)
    expect(afterLogs.totalDocs).toBe(beforeLogs.totalDocs)
    expect(baselineAfter.operationID).toBe(duplicateOperationID)
    expect(baselineAfter.undone).toBe(false)
  }, 60_000)

  it('isolates two candidate clients that submit the same canonical URL under distinct stable source IDs', async () => {
    const marker = randomUUID()
    const createClient = (label: string) => payload.create({
      collection: 'users',
      data: {
        candidateActive: true,
        candidateClientID: `postgres-shared-url-${label}-${marker}`,
        candidateTokenHash: randomBytes(32).toString('hex'),
        email: `postgres-shared-url-${label}-${marker}@synthetic.invalid`,
        password: randomBytes(24).toString('base64url'),
        role: 'candidate-client',
      },
      overrideAccess: true,
      showHiddenFields: true,
    }) as Promise<Doc>
    const [clientA, clientB] = await Promise.all([createClient('a'), createClient('b')])
    const sourceURLs = [
      `https://SYNTHETIC.invalid/postgres/shared/${marker}/?b=2&a=1&utm_source=discarded#fragment`,
      `https://synthetic.invalid/postgres/shared/${marker}?a=1&b=2`,
    ]
    const candidateBody = (label: string, sourceURL: string) => ({
      candidate: {
        id: `postgres-shared-url-candidate-${label}-${marker}`,
        images: [],
        raw_character_names: ['Synthetic PostgreSQL Character'],
        raw_snapshot: { label, marker },
        raw_title: `PostgreSQL shared URL candidate ${label}`,
        source: {
          source_item_id: `postgres-shared-url-item-${label}-${marker}`,
          source_status: 'active',
          source_type: 'SyntheticPostgres',
          source_url: sourceURL,
        },
      },
      operation: 'candidate_upsert' as const,
      protocol_version: 1 as const,
    })
    const bodyA = candidateBody('a', sourceURLs[0])
    const bodyB = candidateBody('b', sourceURLs[1])
    const beforeLogs = await payload.count({ collection: 'operation-logs', overrideAccess: true })
    const [responseA, responseB] = await Promise.all([
      candidateUpsertEndpoint.handler(await jsonRequest(clientA, bodyA)),
      candidateUpsertEndpoint.handler(await jsonRequest(clientB, bodyB)),
    ])
    expect(responseA.status).toBe(201)
    expect(responseB.status).toBe(201)
    const [createdA, createdB] = await Promise.all([
      responseA.json() as Promise<Doc>,
      responseB.json() as Promise<Doc>,
    ])
    const [candidateA, candidateB, sourceA, sourceB] = await Promise.all([
      payload.findByID({
        collection: 'candidate-records',
        depth: 0,
        id: Number(createdA.candidate_id),
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'candidate-records',
        depth: 0,
        id: Number(createdB.candidate_id),
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'source-records',
        depth: 0,
        id: Number(createdA.source_id),
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'source-records',
        depth: 0,
        id: Number(createdB.source_id),
        overrideAccess: true,
      }),
    ])
    expect(sourceA.id).not.toBe(sourceB.id)
    expect(sourceA.canonicalUrl).toBe(sourceB.canonicalUrl)
    expect(relationID(sourceA.candidateOwner)).toBe(clientA.id)
    expect(relationID(sourceB.candidateOwner)).toBe(clientB.id)
    expect(relationID(candidateA.candidateOwner)).toBe(clientA.id)
    expect(relationID(candidateB.candidateOwner)).toBe(clientB.id)

    const beforeCrossOwner = await Promise.all([
      payload.count({ collection: 'candidate-records', overrideAccess: true }),
      payload.count({ collection: 'source-records', overrideAccess: true }),
      payload.count({ collection: 'operation-logs', overrideAccess: true }),
    ])
    const crossOwner = await candidateUpsertEndpoint.handler(await jsonRequest(clientB, bodyA))
    const crossOwnerBody = await crossOwner.json() as Doc
    expect(crossOwner.status).toBe(400)
    expect(String(crossOwnerBody.error)).toContain('owned by another client')
    const afterCrossOwner = await Promise.all([
      payload.count({ collection: 'candidate-records', overrideAccess: true }),
      payload.count({ collection: 'source-records', overrideAccess: true }),
      payload.count({ collection: 'operation-logs', overrideAccess: true }),
    ])
    expect(afterCrossOwner.map((result) => result.totalDocs)).toEqual(
      beforeCrossOwner.map((result) => result.totalDocs),
    )
    expect(afterCrossOwner[2].totalDocs - beforeLogs.totalDocs).toBe(2)
  }, 60_000)

  it('allows exactly one simultaneous administrator to complete one review work item and keeps one audit log', async () => {
    const marker = randomUUID()
    const prototype = await createPrototype('shared review target')
    const source = await payload.create({
      collection: 'source-records',
      data: {
        candidateOnly: true,
        canonicalUrl: `https://synthetic.invalid/postgres/review/${marker}`,
        invalidated: false,
        rawSnapshot: { marker },
        sourceItemId: `postgres-review-${marker}`,
        sourceKey: `syntheticpostgres:id:postgres-review-${marker}`,
        sourceType: 'SyntheticPostgres',
        sourceUrl: `https://synthetic.invalid/postgres/review/${marker}`,
        status: 'active',
      },
      overrideAccess: true,
    })
    const candidate = await payload.create({
      collection: 'candidate-records',
      data: {
        externalKey: `postgres-review-candidate-${marker}`,
        matchState: 'character_pending',
        rawSnapshot: { marker },
        rawTitle: 'PostgreSQL simultaneous review candidate',
        source: source.id,
        status: 'pending',
      },
      draft: false,
      overrideAccess: true,
    })
    const openRequest = await adminRequest(adminA)
    const workItem = await openReviewWorkItem(openRequest, {
      allowedTargetIDs: [prototype.id],
      candidateID: candidate.id,
      reason: 'PostgreSQL simultaneous review setup',
    })
    const [requestA, requestB] = await Promise.all([adminRequest(adminA), adminRequest(adminB)])
    const barrier = twoPartyBarrier()
    const originalFindByID = (payload as any).findByID.bind(payload)
    const synchronizedRequests = new Set<PayloadRequest>()
    ;(payload as any).findByID = async (options: Record<string, any>) => {
      const document = await originalFindByID(options)
      if (
        options.collection === 'review-work-items' &&
        Number(options.id) === Number(workItem.id) &&
        (options.req === requestA || options.req === requestB) &&
        !synchronizedRequests.has(options.req)
      ) {
        synchronizedRequests.add(options.req)
        await barrier()
      }
      return document
    }
    const beforeCompletionLogs = await payload.count({
      collection: 'operation-logs',
      overrideAccess: true,
      where: { operationType: { equals: 'review_work_item_completed' } },
    })
    let results: PromiseSettledResult<unknown>[]
    try {
      results = await Promise.allSettled([
        validateAndAdvanceReviewWorkItem(requestA, {
          candidateID: candidate.id,
          complete: true,
          expectedVersion: Number(workItem.lockVersion),
          reason: 'PostgreSQL simultaneous review administrator A',
          targetID: prototype.id,
          workItemID: workItem.id,
        }),
        validateAndAdvanceReviewWorkItem(requestB, {
          candidateID: candidate.id,
          complete: true,
          expectedVersion: Number(workItem.lockVersion),
          reason: 'PostgreSQL simultaneous review administrator B',
          targetID: prototype.id,
          workItemID: workItem.id,
        }),
      ])
    } finally {
      ;(payload as any).findByID = originalFindByID
    }
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String((rejected[0].reason as Error)?.message ?? rejected[0].reason)).toMatch(
      /Concurrent PostgreSQL transaction conflict|Review work item version conflict/,
    )

    const [completed, afterCompletionLogs] = await Promise.all([
      payload.findByID({
        collection: 'review-work-items',
        depth: 0,
        id: workItem.id,
        overrideAccess: true,
      }),
      payload.count({
        collection: 'operation-logs',
        overrideAccess: true,
        where: { operationType: { equals: 'review_work_item_completed' } },
      }),
    ])
    expect(completed.status).toBe('completed')
    expect(completed.lockVersion).toBe(2)
    expect([adminA.id, adminB.id]).toContain(relationID(completed.reviewer))
    expect(afterCompletionLogs.totalDocs - beforeCompletionLogs.totalDocs).toBe(1)
  }, 60_000)

  it('keeps prototype lock versions monotonic after specified undo and rejects a pre-operation stale version', async () => {
    const retained = await createPrototype('monotonic undo retained')
    const merged = await createPrototype('monotonic undo merged')
    const mergeRequest = await adminRequest(adminA)
    const mergeLog = await mergePrototypes(mergeRequest, {
      expectedMergedVersion: 1,
      expectedRetainedVersion: 1,
      mergedPrototypeID: merged.id,
      reason: 'PostgreSQL monotonic undo setup',
      retainedPrototypeID: retained.id,
    })
    const undoRequest = await adminRequest(adminA)
    await undoOperationByID(
      undoRequest,
      String(mergeLog.operationID),
      'PostgreSQL monotonic specified undo',
    )

    const [retainedAfterUndo, mergedAfterUndo, beforeStaleLogs] = await Promise.all([
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: retained.id,
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: merged.id,
        overrideAccess: true,
      }),
      payload.count({
        collection: 'operation-logs',
        overrideAccess: true,
        where: { operationType: { equals: 'maintain_formal' } },
      }),
    ])
    expect(retainedAfterUndo.lockVersion).toBe(3)
    expect(mergedAfterUndo.lockVersion).toBe(3)
    expect(mergedAfterUndo.publicationStatus).toBe('draft')
    expect(mergedAfterUndo.mergedInto).toBeFalsy()

    const staleRequest = await adminRequest(adminB)
    await expect(
      maintainFormalRecord(staleRequest, {
        collection: 'figure-prototypes',
        data: { title: 'A stale write must never become valid again' },
        expectedVersion: 1,
        id: retained.id,
        reason: 'PostgreSQL stale-after-undo attack',
      }),
    ).rejects.toThrow('FigurePrototype version conflict.')

    const [retainedAfterStaleWrite, afterStaleLogs] = await Promise.all([
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: retained.id,
        overrideAccess: true,
      }),
      payload.count({
        collection: 'operation-logs',
        overrideAccess: true,
        where: { operationType: { equals: 'maintain_formal' } },
      }),
    ])
    expect(retainedAfterStaleWrite.title).toBe(retainedAfterUndo.title)
    expect(retainedAfterStaleWrite.lockVersion).toBe(3)
    expect(afterStaleLogs.totalDocs).toBe(beforeStaleLogs.totalDocs)
  }, 60_000)

  it('blocks a prerequisite undo after later audited formal maintenance overlaps its resource scope', async () => {
    const retained = await createPrototype('overlap guard retained')
    const merged = await createPrototype('overlap guard merged')
    const mergeLog = await mergePrototypes(await adminRequest(adminA), {
      expectedMergedVersion: 1,
      expectedRetainedVersion: 1,
      mergedPrototypeID: merged.id,
      reason: 'PostgreSQL overlap guard merge',
      retainedPrototypeID: retained.id,
    })
    const maintainedTitle = `PostgreSQL maintained after merge ${randomUUID()}`
    await maintainFormalRecord(await adminRequest(adminB), {
      collection: 'figure-prototypes',
      data: { title: maintainedTitle },
      expectedVersion: 2,
      id: retained.id,
      reason: 'PostgreSQL later overlapping formal maintenance',
    })
    const beforeUndoLogs = await payload.count({ collection: 'operation-logs', overrideAccess: true })

    await expect(
      undoOperationByID(
        await adminRequest(adminA),
        String(mergeLog.operationID),
        'PostgreSQL unsafe prerequisite undo attempt',
      ),
    ).rejects.toThrow(/later active operation .* overlaps its resource scope/)

    const [retainedAfter, mergedAfter, originalAfter, afterUndoLogs] = await Promise.all([
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: retained.id,
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
      payload.count({ collection: 'operation-logs', overrideAccess: true }),
    ])
    expect(retainedAfter.title).toBe(maintainedTitle)
    expect(retainedAfter.lockVersion).toBe(3)
    expect(mergedAfter.publicationStatus).toBe('merged')
    expect(relationID(mergedAfter.mergedInto)).toBe(retained.id)
    expect(originalAfter.undone).toBe(false)
    expect(afterUndoLogs.totalDocs).toBe(beforeUndoLogs.totalDocs)
  }, 60_000)

  it('allows exactly one simultaneous administrator to maintain one formal prototype and keeps one audit log', async () => {
    const prototype = await createPrototype('simultaneous formal maintenance')
    const [requestA, requestB] = await Promise.all([adminRequest(adminA), adminRequest(adminB)])
    const barrier = twoPartyBarrier()
    const originalFindByID = (payload as any).findByID.bind(payload)
    const synchronizedRequests = new Set<PayloadRequest>()
    ;(payload as any).findByID = async (options: Record<string, any>) => {
      const document = await originalFindByID(options)
      if (
        options.collection === 'figure-prototypes' &&
        Number(options.id) === Number(prototype.id) &&
        (options.req === requestA || options.req === requestB) &&
        !synchronizedRequests.has(options.req)
      ) {
        synchronizedRequests.add(options.req)
        await barrier()
      }
      return document
    }
    const beforeLogs = await payload.count({
      collection: 'operation-logs',
      overrideAccess: true,
      where: { operationType: { equals: 'maintain_formal' } },
    })
    const titles = [
      `PostgreSQL simultaneous formal administrator A ${randomUUID()}`,
      `PostgreSQL simultaneous formal administrator B ${randomUUID()}`,
    ]
    let results: PromiseSettledResult<unknown>[]
    try {
      results = await Promise.allSettled([
        maintainFormalRecord(requestA, {
          collection: 'figure-prototypes',
          data: { title: titles[0] },
          expectedVersion: 1,
          id: prototype.id,
          reason: 'PostgreSQL simultaneous formal administrator A',
        }),
        maintainFormalRecord(requestB, {
          collection: 'figure-prototypes',
          data: { title: titles[1] },
          expectedVersion: 1,
          id: prototype.id,
          reason: 'PostgreSQL simultaneous formal administrator B',
        }),
      ])
    } finally {
      ;(payload as any).findByID = originalFindByID
    }

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String((rejected[0].reason as Error)?.message ?? rejected[0].reason)).toMatch(
      /Concurrent PostgreSQL transaction conflict|FigurePrototype version conflict/,
    )

    const [maintained, afterLogs] = await Promise.all([
      payload.findByID({
        collection: 'figure-prototypes',
        depth: 0,
        id: prototype.id,
        overrideAccess: true,
      }),
      payload.count({
        collection: 'operation-logs',
        overrideAccess: true,
        where: { operationType: { equals: 'maintain_formal' } },
      }),
    ])
    expect(maintained.lockVersion).toBe(2)
    expect(titles).toContain(maintained.title)
    expect(afterLogs.totalDocs - beforeLogs.totalDocs).toBe(1)
  }, 60_000)
})
