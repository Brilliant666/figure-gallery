import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { loadDomainFixture } from '@/domain/fixture'
import { maintainFormalRecord, openReviewWorkItem, revokeCandidateClient, validateAndAdvanceReviewWorkItem } from '@/domain/val02bDomainService'
import { seedPayload } from '@/domain/seed'
import { adminDomainEndpoint } from '@/endpoints/adminDomain'
import { candidateReviewEndpoint } from '@/endpoints/candidateReview'
import { candidateUpsertEndpoint } from '@/endpoints/candidateUpsert'

type Doc = Record<string, any>
type CaseResult = {
  case_id: string
  http_status?: number
  marker_matched: boolean
  observed_rejection: 'exception' | 'http' | 'none'
  operation_log_unchanged: boolean
  rejection_marker: string
  state_unchanged: boolean
  status: 'fail' | 'pass'
  surface: string
}

type RejectionExpectation = {
  exceptionMarker?: RegExp
  httpMarker?: RegExp
  httpStatuses?: readonly number[]
  marker: string
}

const required = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the production security gate.`)
  return value
}

if (process.env.PAYLOAD_CI_PRODUCTION_GATE !== 'true') {
  throw new Error('ci-security-gates is restricted to PAYLOAD_CI_PRODUCTION_GATE=true.')
}
if (process.env.DATABASE_ADAPTER !== 'postgres') {
  throw new Error('ci-security-gates requires DATABASE_ADAPTER=postgres.')
}
if (!/^postgres(?:ql)?:\/\//.test(required('DATABASE_URI'))) {
  throw new Error('ci-security-gates requires a PostgreSQL DATABASE_URI.')
}
if (process.env.S3_ENABLED !== 'true') {
  throw new Error('ci-security-gates requires the real S3 adapter.')
}
const s3Endpoint = new URL(required('S3_ENDPOINT'))
if (
  s3Endpoint.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(s3Endpoint.hostname) ||
  !s3Endpoint.port
) {
  throw new Error('ci-security-gates requires an explicit loopback HTTP S3 endpoint and port.')
}

const outputArg = process.argv.find((argument) => argument.startsWith('--out='))?.slice('--out='.length)
if (!outputArg) throw new Error('--out=<runner-temp-json-path> is required.')
const runnerTemp = path.resolve(required('RUNNER_TEMP'))
const outputPath = path.resolve(outputArg)
if (!outputPath.startsWith(`${runnerTemp}${path.sep}`)) {
  throw new Error('ci-security-gates output must remain below RUNNER_TEMP.')
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !['createdAt', 'updatedAt'].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

const digest = (value: unknown): string =>
  createHash('sha256').update(canonical(value), 'utf8').digest('hex')

const relationIDs = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(relationIDs)
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: unknown }).id
  }
  return value
}

const invariantCollections = [
  'works',
  'characters',
  'manufacturers',
  'figure-prototypes',
  'figure-versions',
  'source-records',
  'candidate-records',
  'media',
  'review-work-items',
] as const

const stateSnapshot = async (payload: Payload) => {
  const collections: Record<string, unknown[]> = {}
  for (const collection of invariantCollections) {
    const result = await payload.find({
      collection,
      depth: 0,
      limit: 0,
      overrideAccess: true,
      showHiddenFields: false,
      sort: 'id',
    })
    collections[collection] = result.docs.map((document) =>
      Object.fromEntries(
        Object.entries(document as Doc)
          .filter(([key]) => !['createdAt', 'updatedAt', 'url', 'thumbnailURL', 'sizes'].includes(key))
          .map(([key, value]) => [key, relationIDs(value)]),
      ),
    )
  }
  const logs = await payload.find({
    collection: 'operation-logs',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    showHiddenFields: false,
    sort: 'id',
  })
  const normalizedLogs = logs.docs.map((document) =>
    Object.fromEntries(
      Object.entries(document as Doc)
        .filter(([key]) => !['createdAt', 'updatedAt'].includes(key))
        .map(([key, value]) => [key, relationIDs(value)]),
    ),
  )
  return {
    collectionCounts: Object.fromEntries(
      Object.entries(collections).map(([name, documents]) => [name, documents.length]),
    ),
    operationDigest: digest(normalizedLogs),
    operationLogCount: normalizedLogs.length,
    stateDigest: digest(collections),
  }
}

const jsonRequest = async (
  payload: Payload,
  user: Doc | undefined,
  body: Record<string, unknown>,
): Promise<PayloadRequest> => {
  const request = await createLocalReq(user ? { user: user as never } : {}, payload)
  Object.defineProperty(request, 'json', {
    configurable: true,
    value: async () => structuredClone(body),
  })
  return request
}

const tokenRequest = async (
  payload: Payload,
  token: string,
  body: Record<string, unknown>,
): Promise<PayloadRequest> => {
  const request = await createLocalReq({}, payload)
  Object.defineProperty(request, 'headers', {
    configurable: true,
    value: new Headers({ authorization: `users API-Key ${token}` }),
  })
  Object.defineProperty(request, 'json', {
    configurable: true,
    value: async () => structuredClone(body),
  })
  return request
}

const candidateBody = (label: string) => ({
  candidate: {
    id: `ci-security-${label}`,
    images: [],
    raw_character_names: ['Synthetic Character'],
    raw_snapshot: { fixture: true, label },
    raw_title: `Synthetic security candidate ${label}`,
    source: {
      is_stale: false,
      source_item_id: `ci-security-${label}`,
      source_status: 'active',
      source_type: 'synthetic-ci',
      source_url: `https://synthetic.invalid/security/${label}`,
    },
  },
  operation: 'candidate_upsert' as const,
  protocol_version: 1 as const,
})

const fixtureDocument = (map: Map<string, Doc>, fixtureID: string): Doc => {
  const document = map.get(fixtureID)
  if (!document) throw new Error(`Required synthetic fixture is missing: ${fixtureID}`)
  return document
}

const results: CaseResult[] = []
let payload: Payload | undefined
let finalCounts: Record<string, number> = {}
let failedCaseID: null | string = null
let revokedCredentialPrepared = false

const writeResult = async (overallStatus: 'fail' | 'pass') => {
  const expectedCaseIDs = [
    'SEC-01-NO-TOKEN',
    'SEC-02-WRONG-TOKEN',
    'SEC-03-REVOKED-TOKEN',
    'SEC-04-CROSS-CLIENT-OWNER',
    'SEC-05-CANDIDATE-WRITES-FIGURE-PROTOTYPE',
    'SEC-06-CANDIDATE-WRITES-FIGURE-VERSION',
    'SEC-07-CANDIDATE-WRITES-MAIN-IMAGE',
    'SEC-08-GENERIC-CANDIDATE-CRUD',
    'SEC-09-LOCAL-API-OVERRIDE-SERVICE',
    'SEC-10-ADMIN-GENERIC-SAVE',
    'SEC-11-OUT-OF-SCOPE-REVIEW-TARGET',
    'SEC-12-COMPLETED-WORK-ITEM-MODIFICATION',
  ]
  const observed = results.map((result) => result.case_id)
  const complete = canonical(observed) === canonical(expectedCaseIDs)
  const status = overallStatus === 'pass' && complete && results.every((result) => result.status === 'pass')
    ? 'pass'
    : 'fail'
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        adapter: 'postgres',
        case_count: results.length,
        cases: results,
        expected_case_count: expectedCaseIDs.length,
        failed_case_id: failedCaseID,
        formal_collection_counts: finalCounts,
        gate: 'PG-14',
        overall_status: status,
        revoked_identity_prepared: revokedCredentialPrepared,
        s3_endpoint_scope: 'loopback',
        schema_version: 1,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

try {
  const { default: config } = await import('@payload-config')
  payload = await getPayload({ config })
  const { fixture } = await loadDomainFixture<Doc>()
  const maps = await seedPayload(payload, fixture as never)

  const admin = await payload.create({
    collection: 'users',
    data: {
      candidateActive: true,
      email: `ci-security-admin-${randomUUID()}@synthetic.invalid`,
      password: randomBytes(32).toString('base64url'),
      role: 'admin',
    },
    overrideAccess: true,
    showHiddenFields: true,
  }) as Doc
  const adminRequest = await createLocalReq({ user: admin as never }, payload)

  const createClient = async (label: string, token: string) => payload!.create({
    collection: 'users',
    data: {
      candidateActive: true,
      candidateClientID: `ci-security-${label}-${randomUUID()}`,
      candidateTokenHash: createHash('sha256').update(token, 'utf8').digest('hex'),
      email: `ci-security-${label}-${randomUUID()}@synthetic.invalid`,
      enableAPIKey: false,
      password: randomBytes(32).toString('base64url'),
      role: 'candidate-client',
    },
    overrideAccess: true,
    showHiddenFields: true,
  }) as Promise<Doc>

  const tokenA = randomBytes(32).toString('base64url')
  const tokenB = randomBytes(32).toString('base64url')
  const revokedToken = process.env.VAL02_PAYLOAD_REVOKED_TOKEN?.trim() || randomBytes(32).toString('base64url')
  const revokedTokenHash = createHash('sha256').update(revokedToken, 'utf8').digest('hex')
  const clientA = await createClient('client-a', tokenA)
  await createClient('client-b', tokenB)
  const existingRevoked = await payload.find({
    collection: 'users',
    limit: 1,
    overrideAccess: true,
    showHiddenFields: true,
    where: { candidateTokenHash: { equals: revokedTokenHash } },
  })
  const revokedClient = existingRevoked.docs[0] as Doc | undefined
    ?? await createClient('revoked-client', revokedToken)
  if (revokedClient.candidateActive !== false) {
    await revokeCandidateClient(adminRequest, {
      clientUserID: revokedClient.id,
      reason: 'CI security gate prepares a revoked runtime credential',
    })
  }
  revokedCredentialPrepared = true

  const runCase = async (
    caseID: string,
    surface: string,
    expectation: RejectionExpectation,
    action: () => Promise<Response | unknown>,
  ) => {
    const before = await stateSnapshot(payload!)
    let rejected = false
    let markerMatched = false
    let observedRejection: CaseResult['observed_rejection'] = 'none'
    let httpStatus: number | undefined
    try {
      const response = await action()
      if (response instanceof Response) {
        observedRejection = 'http'
        httpStatus = response.status
        let responseMarker = ''
        try {
          const body = await response.clone().json() as { error?: unknown }
          responseMarker = typeof body.error === 'string' ? body.error : ''
        } catch {
          responseMarker = ''
        }
        markerMatched = Boolean(expectation.httpMarker?.test(responseMarker))
        rejected =
          response.status >= 400 &&
          response.status < 500 &&
          Boolean(expectation.httpStatuses?.includes(response.status)) &&
          markerMatched
      }
    } catch (error) {
      observedRejection = 'exception'
      const message = error instanceof Error ? error.message : String(error)
      markerMatched = Boolean(expectation.exceptionMarker?.test(message))
      rejected = markerMatched
    }
    const after = await stateSnapshot(payload!)
    const stateUnchanged = before.stateDigest === after.stateDigest
    const operationLogUnchanged = before.operationDigest === after.operationDigest
      && before.operationLogCount === after.operationLogCount
    const passed = rejected && stateUnchanged && operationLogUnchanged
    results.push({
      case_id: caseID,
      ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
      marker_matched: markerMatched,
      observed_rejection: observedRejection,
      operation_log_unchanged: operationLogUnchanged,
      rejection_marker: expectation.marker,
      state_unchanged: stateUnchanged,
      status: passed ? 'pass' : 'fail',
      surface,
    })
    if (!passed) {
      failedCaseID = caseID
      throw new Error(`Security gate failed closed at ${caseID}.`)
    }
  }

  await runCase(
    'SEC-01-NO-TOKEN',
    'candidate endpoint handler',
    {
      httpMarker: /Candidate client access is required/i,
      httpStatuses: [403],
      marker: 'candidate_client_required',
    },
    async () => candidateUpsertEndpoint.handler(
      await jsonRequest(payload!, undefined, candidateBody('no-token')),
    ),
  )
  await runCase(
    'SEC-02-WRONG-TOKEN',
    'candidate endpoint handler',
    {
      httpMarker: /credential is invalid or revoked/i,
      httpStatuses: [403],
      marker: 'invalid_or_revoked_credential',
    },
    async () => candidateUpsertEndpoint.handler(
      await tokenRequest(payload!, randomBytes(32).toString('base64url'), candidateBody('wrong-token')),
    ),
  )
  await runCase(
    'SEC-03-REVOKED-TOKEN',
    'candidate endpoint handler',
    {
      httpMarker: /Candidate client access is required|credential is disabled or revoked/i,
      httpStatuses: [403],
      marker: 'revoked_credential',
    },
    async () => candidateUpsertEndpoint.handler(
      await tokenRequest(payload!, revokedToken, candidateBody('revoked-token')),
    ),
  )

  const ownedBody = candidateBody(`owned-${randomUUID()}`)
  const ownedResponse = await candidateUpsertEndpoint.handler(
    await tokenRequest(payload, tokenA, ownedBody),
  )
  if (ownedResponse.status !== 201) {
    failedCaseID = 'SEC-04-CROSS-CLIENT-OWNER'
    throw new Error('Could not prepare the owned candidate for the cross-client attack.')
  }
  const ownedResult = await ownedResponse.json() as { candidate_id: number }
  await runCase(
    'SEC-04-CROSS-CLIENT-OWNER',
    'candidate endpoint handler',
    {
      httpMarker: /owned by another client/i,
      httpStatuses: [400],
      marker: 'cross_client_owner_conflict',
    },
    async () => candidateUpsertEndpoint.handler(await tokenRequest(payload!, tokenB, ownedBody)),
  )

  const prototype = fixtureDocument(maps.prototypes, 'prototype-orbit-duo')
  const version = fixtureDocument(maps.versions, 'version-p1-standard')
  const mainMedia = fixtureDocument(maps.media, 'media-prototype-05-main')
  const candidateRequest = await createLocalReq({ user: clientA as never }, payload)

  await runCase(
    'SEC-05-CANDIDATE-WRITES-FIGURE-PROTOTYPE',
    'Payload Local API',
    {
      exceptionMarker: /not allowed to perform this action|access denied|forbidden|permission denied/i,
      marker: 'collection_write_access_denied',
    },
    async () => payload!.update({
      collection: 'figure-prototypes',
      data: { publicationStatus: 'hidden' },
      id: prototype.id,
      overrideAccess: false,
      req: candidateRequest,
    }),
  )
  await runCase(
    'SEC-06-CANDIDATE-WRITES-FIGURE-VERSION',
    'Payload Local API',
    {
      exceptionMarker: /not allowed to perform this action|access denied|forbidden|permission denied/i,
      marker: 'collection_write_access_denied',
    },
    async () => payload!.update({
      collection: 'figure-versions',
      data: { name: 'forbidden candidate edit' },
      id: version.id,
      overrideAccess: false,
      req: candidateRequest,
    }),
  )
  await runCase(
    'SEC-07-CANDIDATE-WRITES-MAIN-IMAGE',
    'candidate review endpoint handler',
    {
      httpMarker: /Administrator access is required/i,
      httpStatuses: [403],
      marker: 'administrator_required',
    },
    async () => candidateReviewEndpoint.handler(
      await jsonRequest(payload!, clientA, {
        action: 'select-main-image',
        candidateID: ownedResult.candidate_id,
        mediaID: mainMedia.id,
        prototypeID: prototype.id,
        reason: 'forbidden candidate main-image attack',
      }),
    ),
  )
  await runCase(
    'SEC-08-GENERIC-CANDIDATE-CRUD',
    'generic collection access pipeline',
    {
      exceptionMarker: /not allowed to perform this action|access denied|forbidden|permission denied/i,
      marker: 'generic_candidate_crud_denied',
    },
    async () => (payload! as any).create({
      collection: 'candidate-records',
      data: {
        externalKey: `forbidden-generic-${randomUUID()}`,
        rawSnapshot: {},
        rawTitle: 'forbidden generic candidate',
        source: fixtureDocument(maps.sources, 'source-p1').id,
      },
      overrideAccess: false,
      req: candidateRequest,
    }),
  )
  await runCase(
    'SEC-09-LOCAL-API-OVERRIDE-SERVICE',
    'privileged domain service',
    {
      exceptionMarker: /Administrator access is required/i,
      marker: 'domain_service_administrator_required',
    },
    async () =>
    {
      const endpointResponse = await adminDomainEndpoint.handler(
        await jsonRequest(payload!, clientA, {
          action: 'maintain-formal',
          collection: 'works',
          data: { aliases: ['forbidden endpoint override'] },
          id: fixtureDocument(maps.works, 'work-orbit-chronicles').id,
          overrideAccess: true,
          reason: 'candidate attempts to inject a Local API override flag',
        }),
      )
      const endpointBody = await endpointResponse.clone().json() as { error?: unknown }
      if (
        endpointResponse.status !== 403 ||
        typeof endpointBody.error !== 'string' ||
        !/Administrator access is required/i.test(endpointBody.error)
      ) return endpointResponse
      return maintainFormalRecord(candidateRequest, {
        collection: 'works',
        data: { aliases: ['forbidden local override'] },
        id: fixtureDocument(maps.works, 'work-orbit-chronicles').id,
        reason: 'candidate attempts privileged Local API service',
      })
    },
  )
  await runCase(
    'SEC-10-ADMIN-GENERIC-SAVE',
    'generic Admin Local API save',
    {
      exceptionMarker: /not allowed to perform this action|access denied|forbidden|permission denied/i,
      marker: 'generic_admin_save_denied',
    },
    async () => payload!.update({
      collection: 'figure-prototypes',
      data: { publicationStatus: 'hidden' },
      id: prototype.id,
      overrideAccess: false,
      req: adminRequest,
    }),
  )

  const allowed = fixtureDocument(maps.prototypes, 'prototype-orbit-lin-aurora')
  const outside = fixtureDocument(maps.prototypes, 'prototype-moon-ren-prize')
  const reviewCandidate = fixtureDocument(maps.candidates, 'candidate-main-image-attack')
  const outsideItem = await openReviewWorkItem(adminRequest, {
    allowedTargetIDs: [allowed.id],
    candidateID: reviewCandidate.id,
    reason: 'CI security gate bounded target setup',
  })
  await runCase(
    'SEC-11-OUT-OF-SCOPE-REVIEW-TARGET',
    'review domain service',
    {
      exceptionMarker: /Review target is outside the work item allowed target set/i,
      marker: 'review_target_out_of_scope',
    },
    async () => validateAndAdvanceReviewWorkItem(adminRequest, {
      candidateID: reviewCandidate.id,
      expectedVersion: Number(outsideItem.lockVersion),
      targetID: outside.id,
      workItemID: outsideItem.id,
    }),
  )

  const completedCandidate = fixtureDocument(maps.candidates, 'candidate-new-unmatched')
  const completedItem = await openReviewWorkItem(adminRequest, {
    allowedTargetIDs: [allowed.id],
    candidateID: completedCandidate.id,
    reason: 'CI security gate completed-item setup',
  })
  const completed = await validateAndAdvanceReviewWorkItem(adminRequest, {
    candidateID: completedCandidate.id,
    complete: true,
    expectedVersion: Number(completedItem.lockVersion),
    reason: 'Complete before prohibited follow-up modification',
    targetID: allowed.id,
    workItemID: completedItem.id,
  })
  await runCase(
    'SEC-12-COMPLETED-WORK-ITEM-MODIFICATION',
    'review domain service',
    {
      exceptionMarker: /Completed review work items cannot be modified without reopen/i,
      marker: 'completed_review_item_immutable',
    },
    async () => validateAndAdvanceReviewWorkItem(adminRequest, {
      candidateID: completedCandidate.id,
      expectedVersion: Number(completed.lockVersion),
      targetID: allowed.id,
      workItemID: completedItem.id,
    }),
  )

  finalCounts = (await stateSnapshot(payload)).collectionCounts
  await writeResult('pass')
  console.log(JSON.stringify({ case_count: results.length, status: 'pass' }))
} catch (error) {
  if (payload) finalCounts = (await stateSnapshot(payload)).collectionCounts
  await writeResult('fail')
  throw error
} finally {
  if (payload) await payload.destroy()
}

process.exit(0)
