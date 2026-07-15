import { CatalogDomainError } from '@figure-gallery/domain-contracts'
import { Forbidden, type CollectionBeforeOperationHook, type PayloadRequest } from 'payload'

const authorizedRequests = new WeakSet<PayloadRequest>()

export async function withCatalogDomainWrite<T>(
  req: PayloadRequest,
  operation: () => Promise<T>,
): Promise<T> {
  const alreadyAuthorized = authorizedRequests.has(req)
  authorizedRequests.add(req)
  try {
    return await operation()
  } finally {
    if (!alreadyAuthorized) authorizedRequests.delete(req)
  }
}

export function assertCatalogDomainWrite(req: PayloadRequest): void {
  if (!authorizedRequests.has(req)) {
    throw new CatalogDomainError(
      'CATALOG_DOMAIN_WRITE_REQUIRED',
      'Formal catalog writes must use the catalog domain service.',
      'authorization',
    )
  }
}

export const denyCatalogGenericWrite: CollectionBeforeOperationHook = ({ operation, req }) => {
  if (!['create', 'delete', 'update'].includes(operation)) return
  try {
    assertCatalogDomainWrite(req)
  } catch {
    throw new Forbidden(req.t)
  }
}
