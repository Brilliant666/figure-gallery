import { createHash } from 'node:crypto'
import type { Access, FieldAccess, PayloadRequest, Where } from 'payload'

export type PocRole = 'admin' | 'candidate-client'

type PocUser = {
  candidateActive?: boolean
  candidateClientID?: string
  candidateTokenHash?: string
  collection?: string
  id?: number | string
  role?: PocRole
}

export const userRole = (user: unknown): PocRole | undefined => {
  if (!user || typeof user !== 'object') return undefined
  const role = (user as PocUser).role
  return role === 'admin' || role === 'candidate-client' ? role : undefined
}

export const isAdminUser = (user: unknown): boolean => userRole(user) === 'admin'

export const isCandidateClientUser = (user: unknown): boolean =>
  userRole(user) === 'candidate-client' && (user as PocUser).candidateActive !== false

export const candidateClientID = (user: unknown): string | undefined => {
  if (!isCandidateClientUser(user)) return undefined
  const value = (user as PocUser).candidateClientID
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export const adminOnly: Access = ({ req }) => isAdminUser(req.user)

export const adminFieldOnly: FieldAccess = ({ req }) => isAdminUser(req.user)

export const candidateOrAdmin: Access = ({ req }) =>
  isAdminUser(req.user) || isCandidateClientUser(req.user)

export const isPublicReadEnabled = async (req: PayloadRequest): Promise<boolean> => {
  try {
    const settings = await req.payload.findGlobal({
      overrideAccess: true,
      req,
      slug: 'system-settings',
    })
    return settings.publicReadEnabled === true
  } catch {
    return false
  }
}

export const publicReadOrAdmin: Access = async ({ req }) => {
  if (isAdminUser(req.user)) return true
  if (!(await isPublicReadEnabled(req))) return false

  return {
    and: [
      { publicationStatus: { equals: 'published' } },
      { softDeleted: { equals: false } },
    ],
  } as Where
}

export const requireAdmin = (req: PayloadRequest): void => {
  if (!isAdminUser(req.user)) throw new Error('Administrator access is required.')
}

export const requireCandidateOrAdmin = (req: PayloadRequest): void => {
  if (!isAdminUser(req.user) && !isCandidateClientUser(req.user)) {
    throw new Error('Candidate client or administrator access is required.')
  }
}

export const requireCandidateClient = (req: PayloadRequest): void => {
  if (!isCandidateClientUser(req.user)) {
    throw new Error('Candidate client access is required.')
  }
  if (!candidateClientID(req.user)) {
    throw new Error('Candidate client identity is incomplete or revoked.')
  }
}

/**
 * Re-read the authenticated client from storage before every privileged
 * candidate command.  This makes revocation effective even when a request
 * object was created before the administrator disabled the credential.
 */
export const requireActiveCandidateClient = async (req: PayloadRequest): Promise<{
  clientID: string
  userID: number | string
}> => {
  let user = req.user as PocUser | null
  if (!isCandidateClientUser(user)) {
    const authorization = req.headers.get('authorization') ?? ''
    const match = /^users API-Key (\S+)$/.exec(authorization)
    if (!match) throw new Error('Candidate client access is required.')
    const tokenHash = createHash('sha256').update(match[1], 'utf8').digest('hex')
    const found = await req.payload.find({
      collection: 'users',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      req,
      showHiddenFields: true,
      where: { candidateTokenHash: { equals: tokenHash } },
    })
    user = found.docs[0] as PocUser | undefined ?? null
    if (!user) throw new Error('Candidate client credential is invalid or revoked.')
    req.user = user as never
  }
  requireCandidateClient(req)
  if (!user || user.id === undefined) throw new Error('Candidate client user ID is required.')
  const current = await req.payload.findByID({
    collection: 'users',
    depth: 0,
    id: user.id,
    overrideAccess: true,
    req,
    showHiddenFields: true,
  })
  if (!isCandidateClientUser(current) || !candidateClientID(current)) {
    throw new Error('Candidate client credential is disabled or revoked.')
  }
  const clientID = candidateClientID(current)!
  // Never trust a caller-supplied identity that disagrees with current state.
  if (candidateClientID(user) !== clientID) {
    throw new Error('Candidate client identity does not match the active credential.')
  }
  return { clientID, userID: current.id }
}
