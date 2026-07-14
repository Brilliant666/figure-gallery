import type { AdminViewServerProps } from 'payload'

import { isAdminUser } from '@/security/roles'
import { CandidateReviewClient, type CandidateReviewItem } from './CandidateReviewClient'

const relationID = (value: unknown): null | number | string => {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

export async function CandidateReviewView({ initPageResult }: AdminViewServerProps) {
  const req = initPageResult.req

  // Payload custom views are public by default. This check is deliberately in
  // the server component, in addition to the endpoint's administrator check.
  if (!isAdminUser(req.user)) {
    return (
      <main style={{ margin: '3rem auto', maxWidth: 760 }}>
        <h1>Candidate review</h1>
        <p role="alert">Administrator access is required.</p>
      </main>
    )
  }

  const [candidateResult, prototypeResult, versionResult, characterResult, manufacturerResult] =
    await Promise.all([
      req.payload.find({
        collection: 'candidate-records',
        depth: 1,
        limit: 50,
        overrideAccess: false,
        req,
        sort: '-updatedAt',
      }),
      req.payload.find({
        collection: 'figure-prototypes',
        depth: 0,
        limit: 100,
        overrideAccess: true,
        req,
      }),
      req.payload.find({
        collection: 'figure-versions',
        depth: 0,
        limit: 200,
        overrideAccess: true,
        req,
      }),
      req.payload.find({
        collection: 'characters',
        depth: 0,
        limit: 100,
        overrideAccess: true,
        req,
      }),
      req.payload.find({
        collection: 'manufacturers',
        depth: 0,
        limit: 100,
        overrideAccess: true,
        req,
      }),
    ])

  const candidates: CandidateReviewItem[] = candidateResult.docs.map((candidate) => ({
    id: candidate.id,
    images: Array.isArray(candidate.images)
      ? candidate.images.map((image) => {
          if (image && typeof image === 'object') {
            return {
              id: relationID(image)!,
              isAdult: Boolean(image.isAdult),
              previewUrl:
                image.sizes &&
                typeof image.sizes === 'object' &&
                'thumbnail' in image.sizes &&
                image.sizes.thumbnail &&
                typeof image.sizes.thumbnail === 'object'
                  ? String(image.sizes.thumbnail.url ?? image.url ?? '')
                  : String(image.url ?? ''),
              sourceUrl: String(image.sourceUrl ?? ''),
              storageKey: String(image.storageKey ?? ''),
            }
          }
          return {
            id: relationID(image)!,
            isAdult: false,
            previewUrl: '',
            sourceUrl: '',
            storageKey: '',
          }
        })
      : [],
    rawFields: {
      category: candidate.rawCategory,
      characters: candidate.rawCharacterNames,
      date: candidate.rawDate,
      manufacturer: candidate.rawManufacturer,
      scale: candidate.rawScale,
      title: candidate.rawTitle,
      work: candidate.rawWorkName,
    },
    reason: candidate.reason ?? '',
    status: String(candidate.status),
    targetPrototypeID: relationID(candidate.targetPrototype),
  }))

  return (
    <CandidateReviewClient
      candidates={candidates}
      characters={characterResult.docs.map((doc) => ({ id: doc.id, label: String(doc.displayName) }))}
      manufacturers={manufacturerResult.docs.map((doc) => ({
        disabled: doc.status !== 'active',
        id: doc.id,
        label: `${doc.canonicalName} (${doc.status})`,
      }))}
      prototypes={prototypeResult.docs.map((doc) => ({ id: doc.id, label: String(doc.title) }))}
      versions={versionResult.docs.map((doc) => ({
        id: doc.id,
        label: String(doc.name),
        prototypeID: relationID(doc.prototype)!,
      }))}
    />
  )
}
