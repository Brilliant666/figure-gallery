import { getPayload, createLocalReq } from 'payload'

import config from '@payload-config'
import { openReviewWorkItem } from '@/domain/val02bDomainService'
import { loadDomainFixture } from '@/domain/fixture'
import { seedPayload } from '@/domain/seed'
import { candidateReviewEndpoint } from '@/endpoints/candidateReview'

const email = process.env.VAL02_PAYLOAD_ADMIN_EMAIL?.trim()
const password = process.env.VAL02_PAYLOAD_ADMIN_PASSWORD
if (!email || !password || password.length < 12) {
  throw new Error('Runtime VAL02_PAYLOAD_ADMIN_EMAIL and VAL02_PAYLOAD_ADMIN_PASSWORD (12+ characters) are required.')
}
if (!process.env.PAYLOAD_SECRET) throw new Error('PAYLOAD_SECRET must be supplied at runtime.')

const relationID = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  if (value && typeof value === 'object' && 'id' in value) {
    return relationID((value as { id: unknown }).id)
  }
  return undefined
}

const upsertPaginationClone = async (
  payload: Awaited<ReturnType<typeof getPayload>>,
  fixtureID: string,
  base: Record<string, any>,
  mainImageID: number,
  suffix: string,
) => {
  const existing = await payload.find({
    collection: 'figure-prototypes',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { fixtureID: { equals: fixtureID } },
  })
  const manufacturerID = relationID(base.manufacturer)
  if (!manufacturerID) throw new Error('Pagination clone base must have a manufacturer.')
  const data = {
    characters: (base.characters ?? []).map(relationID).filter((id: number | undefined): id is number => id !== undefined),
    costumeText: base.costumeText,
    figureType: base.figureType,
    fixtureID,
    isAdult: false,
    isGroup: false,
    lockVersion: 1,
    mainImage: mainImageID,
    manufacturer: manufacturerID,
    publicationStatus: 'published' as const,
    scale: base.scale,
    softDeleted: false,
    title: `${base.title}（浏览器分页${suffix}）`,
    work: relationID(base.work),
  }
  return existing.docs[0]
    ? payload.update({
        collection: 'figure-prototypes',
        context: { syntheticSeed: true },
        data,
        draft: false,
        id: existing.docs[0].id,
        overrideAccess: true,
      })
    : payload.create({
        collection: 'figure-prototypes',
        context: { syntheticSeed: true },
        data,
        draft: false,
        overrideAccess: true,
      })
}

const payload = await getPayload({ config })
try {
  const fixture = await loadDomainFixture<Record<string, unknown>>()
  await seedPayload(payload, fixture.fixture as never)

  const users = await payload.find({
    collection: 'users',
    limit: 1,
    overrideAccess: true,
    showHiddenFields: true,
    where: { email: { equals: email } },
  })
  const user = users.docs[0]
    ? await payload.update({
        collection: 'users',
        data: { candidateActive: true, email, password, role: 'admin' },
        id: users.docs[0].id,
        overrideAccess: true,
        showHiddenFields: true,
      })
    : await payload.create({
        collection: 'users',
        data: { candidateActive: true, email, password, role: 'admin' },
        overrideAccess: true,
        showHiddenFields: true,
      })

  const candidates = await payload.find({
    collection: 'candidate-records',
    depth: 0,
    limit: 50,
    overrideAccess: true,
    sort: 'id',
  })
  const candidate = candidates.docs.find(
    (doc) => Array.isArray(doc.images) && doc.images.length >= 2 && relationID(doc.targetPrototype),
  )
  if (!candidate) throw new Error('Synthetic seed did not produce a reviewable candidate with two images and a target.')
  const targetID = relationID(candidate.targetPrototype)!
  const target = await payload.findByID({
    collection: 'figure-prototypes',
    depth: 0,
    id: targetID,
    overrideAccess: true,
  })
  const targetMainImageID = relationID(target.mainImage)
  if (!targetMainImageID) throw new Error('Synthetic browser target must have a formal main image.')
  const alternateMedia = await payload.find({
    collection: 'media',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    sort: 'id',
    where: {
      and: [
        { candidateOnly: { equals: false } },
        { isAdult: { equals: false } },
        { id: { not_equals: targetMainImageID } },
      ],
    },
  })
  const alternateMainImageID = Number(alternateMedia.docs[0]?.id)
  if (!alternateMainImageID) throw new Error('Synthetic seed must provide a second non-adult formal media record.')
  await upsertPaginationClone(
    payload,
    'val02b-browser-pagination-clone-a',
    target as Record<string, any>,
    targetMainImageID,
    '甲',
  )
  await upsertPaginationClone(
    payload,
    'val02b-browser-pagination-clone-b',
    target as Record<string, any>,
    alternateMainImageID,
    '乙',
  )

  const existing = await payload.find({
    collection: 'review-work-items',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [
        { candidate: { equals: candidate.id } },
        { status: { equals: 'open' } },
      ],
    },
  })
  const req = await createLocalReq({ user: user as never }, payload)
  const workItem = existing.docs[0] ?? await openReviewWorkItem(req, {
    allowedTargetIDs: [targetID],
    candidateID: candidate.id,
    reason: 'Prepare synthetic browser-only VAL-02B review work item',
  })

  const adultCandidates = await payload.find({
    collection: 'candidate-records',
    depth: 1,
    limit: 1,
    overrideAccess: true,
    where: { externalKey: { equals: 'candidate-adult-deferred' } },
  })
  const adultCandidate = adultCandidates.docs[0]
  const adultPrototypeID = relationID(adultCandidate?.targetPrototype)
  const adultMedia = (adultCandidate?.images ?? []).find(
    (image) => image && typeof image === 'object' && image.isAdult === true,
  )
  const adultMediaID = relationID(adultMedia)
  if (!adultCandidate || !adultPrototypeID || !adultMediaID) {
    throw new Error('Synthetic seed did not provide the adult visibility fixture.')
  }
  const adultExisting = await payload.find({
    collection: 'review-work-items',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [
        { candidate: { equals: adultCandidate.id } },
        { status: { equals: 'open' } },
      ],
    },
  })
  const adultWorkItem = adultExisting.docs[0] ?? await openReviewWorkItem(req, {
    allowedTargetIDs: [adultPrototypeID],
    candidateID: adultCandidate.id,
    reason: 'Prepare synthetic adult visibility review item',
  })
  const adultReviewReq = await createLocalReq({ user: user as never }, payload)
  Object.defineProperty(adultReviewReq, 'json', {
    configurable: true,
    value: async () => ({
      action: 'select-main-image',
      candidateID: adultCandidate.id,
      expectedVersion: Number(adultWorkItem.lockVersion),
      mediaID: adultMediaID,
      prototypeID: adultPrototypeID,
      reason: 'Select synthetic adult main image for visibility browser gate',
      workItemID: adultWorkItem.id,
    }),
  })
  const adultReviewResponse = await candidateReviewEndpoint.handler(adultReviewReq)
  if (adultReviewResponse.status !== 200) {
    throw new Error(`Adult visibility fixture review failed: ${await adultReviewResponse.text()}`)
  }
  const adultPrototype = await payload.findByID({
    collection: 'figure-prototypes',
    depth: 0,
    id: adultPrototypeID,
    overrideAccess: true,
  })
  const adultCharacterID = relationID((adultPrototype.characters ?? [])[0])

  console.log(JSON.stringify({
    admin_url: '/admin',
    adult_candidate_id: adultCandidate.id,
    adult_gallery_alias: '月庭林',
    adult_gallery_url: `/characters/${adultCharacterID}`,
    adult_media_id: adultMediaID,
    adult_prototype_id: adultPrototypeID,
    candidate_id: candidate.id,
    gallery_alias: '轨道林',
    gallery_character_id: relationID((target.characters ?? [])[0]),
    gallery_page_1_url: `/characters/${relationID((target.characters ?? [])[0])}`,
    gallery_page_2_url: `/characters/${relationID((target.characters ?? [])[0])}?page=2`,
    review_url: '/admin/candidate-review',
    target_prototype_id: targetID,
    work_item_id: workItem.id,
  }))
} finally {
  await payload.destroy()
}

process.exit(0)
