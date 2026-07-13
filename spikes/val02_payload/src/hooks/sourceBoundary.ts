import type { CollectionBeforeChangeHook } from 'payload'

import { canonicalizeSourceURL, makeSourceKey } from '@/domain/sourceKey'
import { isCandidateClientUser } from '@/security/roles'

export const deriveSourceIdentity: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  const sourceType = String(data.sourceType ?? originalDoc?.sourceType ?? '')
  const sourceItemId = data.sourceItemId ?? originalDoc?.sourceItemId ?? null
  const sourceUrl = String(data.sourceUrl ?? originalDoc?.sourceUrl ?? '')

  const candidateContext = isCandidateClientUser(req.user) || req.context?.candidateSync === true

  if (candidateContext) {
    const owner =
      originalDoc?.candidateOwner && typeof originalDoc.candidateOwner === 'object'
        ? originalDoc.candidateOwner.id
        : originalDoc?.candidateOwner
    if (
      originalDoc?.id &&
      (originalDoc.candidateOnly !== true || String(owner) !== String(req.user?.id))
    ) {
      throw new Error('Candidate clients cannot update formal or foreign source records.')
    }
    if (data.prototype) {
      throw new Error('Candidate clients cannot attach sources directly to formal prototypes.')
    }
  }

  return {
    ...data,
    candidateOnly: candidateContext
      ? true
      : (data.candidateOnly ?? originalDoc?.candidateOnly ?? false),
    candidateOwner: candidateContext
      ? req.user?.id
      : (data.candidateOwner ?? originalDoc?.candidateOwner),
    canonicalUrl: canonicalizeSourceURL(sourceUrl),
    prototype: candidateContext
      ? (originalDoc?.prototype ?? null)
      : (data.prototype ?? originalDoc?.prototype),
    sourceKey: makeSourceKey({ sourceItemId, sourceType, sourceUrl }),
  }
}
