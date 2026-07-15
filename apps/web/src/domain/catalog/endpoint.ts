import { CatalogDomainError } from '@figure-gallery/domain-contracts'
import type { Endpoint } from 'payload'

import { requireCatalogAdmin } from './authorization'
import { parseCatalogCommand } from './commands'
import { executeCatalogCommand } from './services'

function statusFor(error: CatalogDomainError): number {
  if (error.kind === 'authentication') return 401
  if (error.kind === 'authorization') return 403
  if (error.kind === 'conflict' || error.kind === 'not_found') return 409
  return 422
}

export const CatalogCommandEndpoint: Endpoint = {
  method: 'post',
  path: '/admin/catalog/commands',
  handler: async (req) => {
    try {
      requireCatalogAdmin(req)
      if (!req.json) {
        throw new CatalogDomainError('CATALOG_COMMAND_INVALID', 'A JSON request body is required.')
      }
      const command = parseCatalogCommand(await req.json())
      const execution = await executeCatalogCommand(req, command)
      return Response.json({ ok: true, ...execution }, { status: 200 })
    } catch (error) {
      if (error instanceof CatalogDomainError) {
        return Response.json(
          {
            error: {
              code: error.code,
              details: error.details,
              message: error.message,
            },
            ok: false,
          },
          { status: statusFor(error) },
        )
      }
      req.payload.logger.error({ err: error, msg: 'Catalog command failed.' })
      return Response.json(
        {
          error: {
            code: 'CATALOG_COMMAND_INVALID',
            message: 'The catalog command could not be completed.',
          },
          ok: false,
        },
        { status: 500 },
      )
    }
  },
}
