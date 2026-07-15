import { CatalogDomainError } from '@figure-gallery/domain-contracts'
import type { PayloadRequest } from 'payload'

export function requireCatalogAdmin(req: PayloadRequest): NonNullable<PayloadRequest['user']> {
  if (!req.user) {
    throw new CatalogDomainError(
      'ADMIN_AUTHENTICATION_REQUIRED',
      'An authenticated Payload administrator is required.',
      'authentication',
    )
  }
  if (req.user.collection !== 'users') {
    throw new CatalogDomainError(
      'ADMIN_AUTHORIZATION_REQUIRED',
      'Only Payload administrators may execute catalog commands.',
      'authorization',
    )
  }
  return req.user
}
