import type {
  CatalogCommandResult,
  JsonValue,
} from '@figure-gallery/domain-contracts'
import type { PayloadRequest } from 'payload'

export type CatalogCommandExecution = {
  replayed: boolean
  result: CatalogCommandResult
}

export type CatalogMutationOutcome = {
  after: Readonly<Record<string, unknown>>
  before?: Readonly<Record<string, unknown>>
  result: CatalogCommandResult
  scopeStableId: string
  scopeType: string
}

export type CatalogActor = {
  id: number | string
  stableLabel: string
}

export type CatalogSnapshot = Record<string, JsonValue | undefined>

export type CatalogCommandContext = {
  actor: CatalogActor
  req: PayloadRequest
}

export type CatalogTransaction = {
  execute: (query: unknown) => Promise<unknown>
}
