import {
  CatalogDomainError,
  type CatalogCommand,
} from '@figure-gallery/domain-contracts'
import type { PayloadRequest } from 'payload'

import { requireCatalogAdmin } from './authorization'
import { executePrototypeCommand, executeVersionCommand } from './entities/figure'
import { executeManufacturerCommand } from './entities/manufacturer'
import { executeWorkCharacterCommand } from './entities/work-character'
import { withCatalogDomainWrite } from './internal-context'
import {
  appendOperationLog,
  catalogRequestDigest,
  findOperationReplay,
} from './operation-log'
import { runCatalogTransaction } from './transactions'
import type { CatalogCommandExecution, CatalogMutationOutcome } from './types'

function postgresError(error: unknown): CatalogDomainError | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  if (record.code === '23505') {
    const constraint = String(record.constraint ?? '')
    if (constraint.includes('operation')) {
      return new CatalogDomainError(
        'CATALOG_OPERATION_ID_CONFLICT',
        'The operation ID is already associated with another request.',
        'conflict',
      )
    }
    if (constraint.includes('manufacturer')) {
      return new CatalogDomainError('MANUFACTURER_DUPLICATE', 'Manufacturer uniqueness conflict.', 'conflict')
    }
    if (constraint.includes('alias')) {
      return new CatalogDomainError('CHARACTER_ALIAS_DUPLICATE', 'Character alias uniqueness conflict.', 'conflict')
    }
    if (constraint.includes('version')) {
      return new CatalogDomainError('FIGURE_VERSION_DUPLICATE', 'Figure version uniqueness conflict.', 'conflict')
    }
    return new CatalogDomainError('CATALOG_RELATION_INVALID', 'Catalog uniqueness conflict.', 'conflict')
  }
  if (record.code === '23503') {
    return new CatalogDomainError(
      'CATALOG_RELATION_INVALID',
      'A referenced catalog entity does not exist or cannot be removed.',
      'conflict',
    )
  }
  if (record.code === '23514' || record.code === '22P02') {
    return new CatalogDomainError(
      'CATALOG_COMMAND_INVALID',
      'The command violates a catalog database constraint.',
      'validation',
      { constraint: record.constraint },
    )
  }
  return null
}

async function dispatchCatalogCommand(
  transaction: Parameters<typeof executeManufacturerCommand>[0],
  command: CatalogCommand,
  actorUserId: number | string,
): Promise<CatalogMutationOutcome> {
  const handlers = [
    executeWorkCharacterCommand,
    executeManufacturerCommand,
    executePrototypeCommand,
    executeVersionCommand,
  ]
  for (const handler of handlers) {
    const outcome = await handler(transaction, command, actorUserId)
    if (outcome) return outcome
  }
  throw new CatalogDomainError(
    'CATALOG_COMMAND_INVALID',
    `Unsupported catalog command: ${command.type}.`,
    'validation',
  )
}

export async function executeCatalogCommand(
  req: PayloadRequest,
  command: CatalogCommand,
): Promise<CatalogCommandExecution> {
  const actor = requireCatalogAdmin(req)
  const requestDigest = catalogRequestDigest(command)
  try {
    return await withCatalogDomainWrite(req, () =>
      runCatalogTransaction(req, async (transaction) => {
        const replay = await findOperationReplay(transaction, command.operationId, requestDigest)
        if (replay.found && !replay.digestMatches) {
          throw new CatalogDomainError(
            'CATALOG_OPERATION_ID_CONFLICT',
            'The operation ID is already associated with a different request.',
            'conflict',
          )
        }
        if (replay.found) {
          if (!replay.result) {
            throw new CatalogDomainError(
              'CATALOG_OPERATION_ID_CONFLICT',
              'The prior operation result is not replayable.',
              'conflict',
            )
          }
          return { replayed: true, result: replay.result }
        }

        const outcome = await dispatchCatalogCommand(transaction, command, actor.id)
        await appendOperationLog({
          actorUserId: actor.id,
          after: outcome.after,
          before: outcome.before,
          command,
          requestDigest,
          result: outcome.result,
          scopeStableId: outcome.scopeStableId,
          scopeType: outcome.scopeType,
          transaction,
        })
        return { replayed: false, result: outcome.result }
      }),
    )
  } catch (error) {
    if (error instanceof CatalogDomainError) throw error
    throw postgresError(error) ?? error
  }
}

type CommandOf<TType extends CatalogCommand['type']> = Extract<CatalogCommand, { type: TType }>

function commandExecutor<TType extends CatalogCommand['type']>(type: TType) {
  return (req: PayloadRequest, command: CommandOf<TType>) => {
    if (command.type !== type) throw new Error(`Expected ${type} command.`)
    return executeCatalogCommand(req, command)
  }
}

export const createWork = commandExecutor('createWork')
export const updateWork = commandExecutor('updateWork')
export const setWorkPublicationStatus = commandExecutor('setWorkPublicationStatus')
export const softDeleteWork = commandExecutor('softDeleteWork')
export const restoreWork = commandExecutor('restoreWork')
export const createCharacter = commandExecutor('createCharacter')
export const updateCharacter = commandExecutor('updateCharacter')
export const addCharacterAlias = commandExecutor('addCharacterAlias')
export const updateCharacterAlias = commandExecutor('updateCharacterAlias')
export const removeCharacterAlias = commandExecutor('removeCharacterAlias')
export const setCharacterStatus = commandExecutor('setCharacterStatus')
export const softDeleteCharacter = commandExecutor('softDeleteCharacter')
export const restoreCharacter = commandExecutor('restoreCharacter')
export const createManufacturer = commandExecutor('createManufacturer')
export const updateManufacturer = commandExecutor('updateManufacturer')
export const setManufacturerStatus = commandExecutor('setManufacturerStatus')
export const softDeleteManufacturer = commandExecutor('softDeleteManufacturer')
export const restoreManufacturer = commandExecutor('restoreManufacturer')
export const createFigurePrototype = commandExecutor('createFigurePrototype')
export const updateFigurePrototype = commandExecutor('updateFigurePrototype')
export const setPrototypeCharacters = commandExecutor('setPrototypeCharacters')
export const reviewPrototypeAuthorization = commandExecutor('reviewPrototypeAuthorization')
export const reviewPrototypeInclusion = commandExecutor('reviewPrototypeInclusion')
export const setPrototypePublicationStatus = commandExecutor('setPrototypePublicationStatus')
export const archivePrototype = commandExecutor('archivePrototype')
export const restorePrototype = commandExecutor('restorePrototype')
export const createFigureVersion = commandExecutor('createFigureVersion')
export const updateFigureVersion = commandExecutor('updateFigureVersion')
export const softDeleteFigureVersion = commandExecutor('softDeleteFigureVersion')
export const restoreFigureVersion = commandExecutor('restoreFigureVersion')
