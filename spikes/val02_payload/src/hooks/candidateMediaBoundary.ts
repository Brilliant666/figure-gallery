import type { CollectionBeforeChangeHook } from 'payload'

import { isCandidateClientUser } from '@/security/roles'
import { assertNoHpoiURL } from '@/security/networkGuard'

const relationID = (value: unknown): unknown =>
  value && typeof value === 'object' && 'id' in value
    ? (value as { id: unknown }).id
    : value

export const candidateMediaBoundary: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if (typeof data.sourceUrl === 'string') assertNoHpoiURL(data.sourceUrl, 'Media source URL')

  if (!isCandidateClientUser(req.user) && req.context?.candidateSync !== true) return data

  const candidateID = relationID(data.candidate ?? originalDoc?.candidate)
  const originalCandidateID = relationID(originalDoc?.candidate)
  if (!candidateID) {
    throw new Error('Candidate media must be attached to a candidate record.')
  }
  if (
    originalDoc?.id &&
    (originalDoc.candidateOnly !== true ||
      !originalCandidateID ||
      String(originalCandidateID) !== String(candidateID))
  ) {
    throw new Error('Candidate clients cannot claim formal or foreign media records.')
  }
  if (data.prototype || data.selectedAsMain === true) {
    throw new Error('Candidate clients cannot attach formal media or select a main image.')
  }

  return {
    ...data,
    candidate: candidateID,
    candidateOnly: true,
    prototype: null,
    selectedAsMain: false,
  }
}
