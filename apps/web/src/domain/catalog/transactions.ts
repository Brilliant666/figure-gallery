import type { PayloadRequest } from 'payload'

export type CatalogSqlTransaction = {
  execute: (query: unknown) => Promise<unknown>
}

type TransactionalDatabase = {
  transaction: <T>(callback: (transaction: CatalogSqlTransaction) => Promise<T>) => Promise<T>
}

export async function runCatalogTransaction<T>(
  req: PayloadRequest,
  callback: (transaction: CatalogSqlTransaction) => Promise<T>,
): Promise<T> {
  const drizzle = req.payload.db.drizzle as unknown as TransactionalDatabase
  return drizzle.transaction(callback)
}
