import type { CollectionBeforeChangeHook } from 'payload'

import { isAdminUser, isCandidateClientUser } from '@/security/roles'

const relationID = (value: unknown): unknown => {
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: unknown }).id
  }
  return value
}

export const protectMainImage: CollectionBeforeChangeHook = ({
  data,
  originalDoc,
  req,
}) => {
  const isCandidateContext = req.context?.candidateSync === true
  const trustedSeedContext = req.payloadAPI === 'local' && req.context?.syntheticSeed === true
  const trustedReviewContext =
    isAdminUser(req.user) && req.context?.manualMainImageReview === true
  const proposed = relationID(data.mainImage) ?? null
  const previous = relationID(originalDoc?.mainImage) ?? null
  const attemptsMainImageChange =
    Object.prototype.hasOwnProperty.call(data, 'mainImage') && proposed !== previous

  if (
    attemptsMainImageChange &&
    (isCandidateContext ||
      isCandidateClientUser(req.user) ||
      (!trustedReviewContext && !trustedSeedContext))
  ) {
    throw new Error('Main image changes must use the audited administrator review action.')
  }

  return data
}
