import type { CatalogCommand, CatalogCommandResult } from '@figure-gallery/domain-contracts'
import {
  CATALOG_FIXTURE_COMMAND_PLAN,
  CATALOG_FIXTURE_ENTITY_KEYS,
  seedCatalog,
} from '@figure-gallery/test-fixtures'
import { describe, expect, it } from 'vitest'

import { parseCatalogCommand } from '../../src/domain/catalog/commands'
import { catalogRequestDigest } from '../../src/domain/catalog/operation-log'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function syntheticStableId(sequence: number): string {
  return `72000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function entityType(command: CatalogCommand): string {
  if (command.type.includes('Work')) return 'Work'
  if (command.type.includes('Character') || command.type.includes('Alias')) return 'Character'
  if (command.type.includes('Manufacturer')) return 'Manufacturer'
  if (command.type.includes('Prototype')) return 'FigurePrototype'
  return 'FigureVersion'
}

function commandStatus(command: CatalogCommand): string | undefined {
  switch (command.type) {
    case 'createWork':
      return 'draft'
    case 'setWorkPublicationStatus':
      return command.publicationStatus
    case 'createCharacter':
      return command.status ?? 'matching_pending'
    case 'setCharacterStatus':
      return command.status
    case 'createManufacturer':
      return 'draft'
    case 'setManufacturerStatus':
      return command.status
    case 'createFigurePrototype':
    case 'reviewPrototypeAuthorization':
    case 'reviewPrototypeInclusion':
      return 'draft'
    case 'createFigureVersion':
    case 'updateFigureVersion':
      return command.releaseStatus
    default:
      return undefined
  }
}

class SyntheticIdempotentExecutor {
  private readonly operations = new Map<string, { digest: string; result: CatalogCommandResult }>()

  private stableSequence = 1

  get uniqueOperationCount(): number {
    return this.operations.size
  }

  execute = async (input: CatalogCommand) => {
    const command = parseCatalogCommand(input)
    const digest = catalogRequestDigest(command)
    const existing = this.operations.get(command.operationId)
    if (existing) {
      if (existing.digest !== digest) throw new Error('Synthetic operation ID digest conflict.')
      return { replayed: true, result: existing.result }
    }

    const stableId =
      'stableId' in command ? command.stableId : syntheticStableId(this.stableSequence++)
    const relatedStableId =
      command.type === 'addCharacterAlias' ? syntheticStableId(this.stableSequence++) : undefined
    const result: CatalogCommandResult = {
      entityType: entityType(command),
      lockVersion: 'expectedVersion' in command ? command.expectedVersion + 1 : 1,
      operationId: command.operationId,
      relatedStableId,
      stableId,
      status: commandStatus(command),
    }
    this.operations.set(command.operationId, { digest, result })
    return { replayed: false, result }
  }
}

function expectCatalogError(input: unknown, code: string): void {
  try {
    parseCatalogCommand(input)
  } catch (error) {
    expect(error).toMatchObject({ code })
    return
  }
  throw new Error(`Expected catalog error ${code}.`)
}

describe('catalog command parser and digest', () => {
  const operationId = '73000000-0000-4000-8000-000000000001'

  it('accepts explicit command shapes and rejects arbitrary collection or patch input', () => {
    expect(
      parseCatalogCommand({
        displayName: 'Synthetic Work',
        operationId,
        reason: 'Synthetic unit test.',
        type: 'createWork',
        workType: 'animation',
      }),
    ).toMatchObject({ type: 'createWork', workType: 'animation' })

    expectCatalogError(
      {
        collection: 'works',
        displayName: 'Synthetic Work',
        operationId,
        reason: 'Synthetic unit test.',
        type: 'createWork',
      },
      'CATALOG_COMMAND_INVALID',
    )
    expectCatalogError(
      {
        expectedVersion: 1,
        operationId,
        patch: { publicationStatus: 'published' },
        reason: 'Synthetic unit test.',
        stableId: '74000000-0000-4000-8000-000000000001',
        type: 'updateWork',
      },
      'CATALOG_COMMAND_INVALID',
    )
  })

  it('rejects malformed identity, empty reasons, and invalid enum values with stable codes', () => {
    expectCatalogError(
      {
        operationId,
        reason: 'Synthetic inherited-property command attack.',
        type: 'toString',
      },
      'CATALOG_COMMAND_INVALID',
    )
    expectCatalogError(
      {
        displayName: 'Synthetic Work',
        operationId: 'not-a-uuid',
        reason: 'Synthetic unit test.',
        type: 'createWork',
      },
      'CATALOG_COMMAND_INVALID',
    )
    expectCatalogError(
      {
        displayName: null,
        operationId,
        reason: 'Synthetic null required-field attack.',
        type: 'createWork',
      },
      'CATALOG_COMMAND_INVALID',
    )
    expectCatalogError(
      { displayName: 'Synthetic Work', operationId, reason: '   ', type: 'createWork' },
      'CATALOG_REASON_REQUIRED',
    )
    expectCatalogError(
      {
        displayName: 'Synthetic Work',
        operationId,
        reason: 'Synthetic unit test.',
        type: 'createWork',
        workType: 'unsupported',
      },
      'CATALOG_COMMAND_INVALID',
    )
    expect(
      parseCatalogCommand({
        expectedVersion: 1,
        operationId,
        reason: 'Synthetic explicit reset to other.',
        stableId: '74000000-0000-4000-8000-000000000001',
        type: 'updateWork',
        workType: null,
      }),
    ).toMatchObject({ type: 'updateWork', workType: null })
  })

  it('uses canonical key ordering for deterministic SHA-256 request digests', () => {
    const left = parseCatalogCommand({
      displayName: 'Synthetic Work',
      operationId,
      reason: 'Synthetic unit test.',
      type: 'createWork',
      workType: 'animation',
    })
    const right = parseCatalogCommand({
      workType: 'animation',
      type: 'createWork',
      reason: 'Synthetic unit test.',
      operationId,
      displayName: 'Synthetic Work',
    })

    expect(catalogRequestDigest(left)).toBe(catalogRequestDigest(right))
    expect(catalogRequestDigest(left)).toMatch(/^[0-9a-f]{64}$/u)
    const changed = parseCatalogCommand({
      displayName: 'Different Synthetic Work',
      operationId,
      reason: 'Synthetic unit test.',
      type: 'createWork',
      workType: 'animation',
    })
    expect(catalogRequestDigest(changed)).not.toBe(catalogRequestDigest(left))
  })
})

describe('synthetic PR-01 catalog fixture', () => {
  it('covers the required fictional catalog shapes without URLs or media', async () => {
    const executor = new SyntheticIdempotentExecutor()
    const seeded = await seedCatalog(executor.execute)
    const commands = seeded.commands

    expect(commands.filter(({ type }) => type === 'createWork')).toHaveLength(2)
    expect(commands.filter(({ type }) => type === 'createCharacter')).toHaveLength(4)
    expect(commands.filter(({ type }) => type === 'createManufacturer')).toHaveLength(3)
    expect(commands.filter(({ type }) => type === 'createFigurePrototype')).toHaveLength(5)

    const characters = commands.filter(
      (command): command is Extract<CatalogCommand, { type: 'createCharacter' }> =>
        command.type === 'createCharacter',
    )
    const sameNameCharacters = characters.filter(({ displayName }) => displayName === 'Aster Vale')
    expect(sameNameCharacters).toHaveLength(2)
    expect(new Set(sameNameCharacters.map(({ workStableId }) => workStableId)).size).toBe(2)

    const manufacturers = commands.filter(
      (command): command is Extract<CatalogCommand, { type: 'setManufacturerStatus' }> =>
        command.type === 'setManufacturerStatus',
    )
    expect(manufacturers.map(({ status }) => status)).toEqual(['active', 'active', 'hidden'])

    const prototypes = commands.filter(
      (command): command is Extract<CatalogCommand, { type: 'createFigurePrototype' }> =>
        command.type === 'createFigurePrototype',
    )
    const sameTitlePrototypes = prototypes.filter(
      ({ title }) => title.trim().replace(/\s+/gu, ' ').toLowerCase() === 'solar arc pose',
    )
    expect(sameTitlePrototypes).toHaveLength(2)
    expect(
      new Set(sameTitlePrototypes.map(({ manufacturerStableId }) => manufacturerStableId)).size,
    ).toBe(2)
    expect(prototypes).toContainEqual(
      expect.objectContaining({
        characters: expect.arrayContaining([
          expect.objectContaining({ role: 'primary' }),
          expect.objectContaining({ role: 'secondary' }),
        ]),
        isGroup: true,
      }),
    )

    const authorization = commands.filter(
      (command): command is Extract<CatalogCommand, { type: 'reviewPrototypeAuthorization' }> =>
        command.type === 'reviewPrototypeAuthorization',
    )
    expect(authorization.map(({ authorizationStatus }) => authorizationStatus)).toContain(
      'authorized_third_party',
    )
    expect(authorization.map(({ authorizationStatus }) => authorizationStatus)).toContain(
      'rejected',
    )
    expect(commands).toContainEqual(
      expect.objectContaining({ inclusionStatus: 'excluded', type: 'reviewPrototypeInclusion' }),
    )

    const versions = commands.filter(
      (command): command is Extract<CatalogCommand, { type: 'createFigureVersion' }> =>
        command.type === 'createFigureVersion',
    )
    expect(new Set(versions.map(({ kind }) => kind))).toEqual(
      new Set(['regular', 'deluxe', 'reissue', 'recolor']),
    )
    expect(versions).toContainEqual(
      expect.objectContaining({
        grayModelCompleteness: 'complete',
        releaseStatus: 'gray_prototype',
      }),
    )
    expect(versions).toContainEqual(
      expect.objectContaining({
        grayModelCompleteness: 'partial',
        releaseStatus: 'gray_prototype',
      }),
    )

    const serialized = JSON.stringify(commands).toLowerCase()
    const prohibitedSourceName = ['hp', 'oi'].join('')
    expect(serialized).not.toContain(prohibitedSourceName)
    expect(serialized).not.toMatch(/https?:/u)
    expect(serialized).not.toMatch(/\.(?:gif|jpe?g|png|webp)/u)
  })

  it('uses fixed unique operation IDs and replays to the same stable result map', async () => {
    const executor = new SyntheticIdempotentExecutor()
    const first = await seedCatalog(executor.execute)
    const second = await seedCatalog(executor.execute)

    expect(first.commands).toHaveLength(CATALOG_FIXTURE_COMMAND_PLAN.length)
    expect(first.replayedOperations).toBe(0)
    expect(second.replayedOperations).toBe(CATALOG_FIXTURE_COMMAND_PLAN.length)
    expect(second.commands).toEqual(first.commands)
    expect(second.stableIds).toEqual(first.stableIds)
    expect(second.results).toEqual(first.results)
    expect(executor.uniqueOperationCount).toBe(CATALOG_FIXTURE_COMMAND_PLAN.length)
    expect(new Set(CATALOG_FIXTURE_COMMAND_PLAN.map(({ operationId }) => operationId)).size).toBe(
      CATALOG_FIXTURE_COMMAND_PLAN.length,
    )
    expect(
      CATALOG_FIXTURE_COMMAND_PLAN.every(({ operationId }) => UUID_PATTERN.test(operationId)),
    ).toBe(true)
    expect(Object.keys(first.stableIds).sort()).toEqual([...CATALOG_FIXTURE_ENTITY_KEYS].sort())
    expect(new Set(Object.values(first.stableIds)).size).toBe(CATALOG_FIXTURE_ENTITY_KEYS.length)
  })
})
