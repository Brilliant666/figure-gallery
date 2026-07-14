import type { Access, FieldAccess, PayloadRequest, Where } from 'payload'

export type PocRole = 'admin' | 'candidate-client'

type PocUser = {
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
  userRole(user) === 'candidate-client'

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
}
