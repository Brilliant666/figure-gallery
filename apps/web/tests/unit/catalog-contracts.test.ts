import {
  CATALOG_ERROR_CODES,
  CATALOG_NORMALIZATION_VERSION,
  CHARACTER_STATUS_TRANSITIONS,
  MANUFACTURER_STATUS_TRANSITIONS,
  PR01_PROTOTYPE_STATUS_TRANSITIONS,
  WORK_STATUS_TRANSITIONS,
  CatalogDomainError,
  authorizationQualifiesForInclusion,
  buildCharacterSearchDocument,
  buildNormalizedVersionKey,
  grayCompletenessIsValid,
  normalizeCatalogName,
  transitionIsAllowed,
  validatePrototypeCharacters,
  versionQualifiesForInclusion,
} from '@figure-gallery/domain-contracts'
import { describe, expect, it } from 'vitest'

describe('catalog normalization version 1', () => {
  it('normalizes Unicode and whitespace without dropping CJK text or translating values', () => {
    expect(CATALOG_NORMALIZATION_VERSION).toBe(1)
    expect(normalizeCatalogName('  ＡSTER\t Vale  ')).toBe('aster vale')
    expect(normalizeCatalogName('  星谷甲  ')).toBe('星谷甲')
    expect(normalizeCatalogName('アステル甲')).toBe('アステル甲')
  })

  it('builds a deterministic, normalized, de-duplicated character search document', () => {
    const input = {
      aliases: ['ASTER VALE', '星之谷'],
      displayName: '  Ａster   Vale ',
      nameEn: 'Aster Vale',
      nameJa: 'アステル甲',
      nameZh: '星谷甲',
      workName: 'Clockwork   Aurora',
    }

    expect(buildCharacterSearchDocument(input)).toBe(
      'aster vale 星谷甲 アステル甲 星之谷 clockwork aurora',
    )
    expect(buildCharacterSearchDocument(input)).toBe(buildCharacterSearchDocument({ ...input }))
  })

  it('builds version keys from the explicit kind, normalized name, and channel', () => {
    expect(
      buildNormalizedVersionKey({
        channelOrDistributorLabel: '  Prism Shop ',
        kind: 'channel-exclusive',
        name: ' Aurora  Variant ',
      }),
    ).toBe('channel-exclusive:aurora variant:prism shop')
  })
})

describe('catalog state transitions', () => {
  it('accepts the specified Work transitions and rejects reverse shortcuts', () => {
    expect(transitionIsAllowed(WORK_STATUS_TRANSITIONS, 'draft', 'published')).toBe(true)
    expect(transitionIsAllowed(WORK_STATUS_TRANSITIONS, 'published', 'hidden')).toBe(true)
    expect(transitionIsAllowed(WORK_STATUS_TRANSITIONS, 'hidden', 'draft')).toBe(true)
    expect(transitionIsAllowed(WORK_STATUS_TRANSITIONS, 'published', 'draft')).toBe(false)
    expect(transitionIsAllowed(WORK_STATUS_TRANSITIONS, 'published', 'published')).toBe(false)
  })

  it('accepts the specified Character and Manufacturer transitions', () => {
    expect(transitionIsAllowed(CHARACTER_STATUS_TRANSITIONS, 'matching_pending', 'active')).toBe(
      true,
    )
    expect(transitionIsAllowed(CHARACTER_STATUS_TRANSITIONS, 'active', 'hidden')).toBe(true)
    expect(transitionIsAllowed(CHARACTER_STATUS_TRANSITIONS, 'hidden', 'matching_pending')).toBe(
      false,
    )
    expect(transitionIsAllowed(MANUFACTURER_STATUS_TRANSITIONS, 'draft', 'active')).toBe(true)
    expect(transitionIsAllowed(MANUFACTURER_STATUS_TRANSITIONS, 'active', 'draft')).toBe(false)
  })

  it('keeps publication and merge capabilities closed in the PR-01 prototype state machine', () => {
    expect(transitionIsAllowed(PR01_PROTOTYPE_STATUS_TRANSITIONS, 'draft', 'hidden')).toBe(true)
    expect(transitionIsAllowed(PR01_PROTOTYPE_STATUS_TRANSITIONS, 'hidden', 'draft')).toBe(true)
    expect(transitionIsAllowed(PR01_PROTOTYPE_STATUS_TRANSITIONS, 'draft', 'published')).toBe(false)
    expect(transitionIsAllowed(PR01_PROTOTYPE_STATUS_TRANSITIONS, 'draft', 'merged')).toBe(false)
  })
})

describe('catalog eligibility primitives', () => {
  it('accepts official and authorized-third-party evidence only', () => {
    expect(authorizationQualifiesForInclusion('official')).toBe(true)
    expect(authorizationQualifiesForInclusion('authorized_third_party')).toBe(true)
    expect(authorizationQualifiesForInclusion('pending')).toBe(false)
    expect(authorizationQualifiesForInclusion('rejected')).toBe(false)
  })

  it('distinguishes valid gray-model data from gray models eligible for inclusion', () => {
    expect(grayCompletenessIsValid('gray_prototype', 'complete')).toBe(true)
    expect(grayCompletenessIsValid('gray_prototype', 'partial')).toBe(true)
    expect(grayCompletenessIsValid('gray_prototype', 'not_applicable')).toBe(false)
    expect(grayCompletenessIsValid('released', 'not_applicable')).toBe(true)
    expect(grayCompletenessIsValid('released', 'complete')).toBe(false)

    expect(versionQualifiesForInclusion('gray_prototype', 'complete')).toBe(true)
    expect(versionQualifiesForInclusion('gray_prototype', 'partial')).toBe(false)
    expect(versionQualifiesForInclusion('released', 'not_applicable')).toBe(true)
    expect(versionQualifiesForInclusion('cancelled', 'not_applicable')).toBe(false)
  })

  it('requires one primary character and coherent group relationships', () => {
    expect(
      validatePrototypeCharacters(
        [{ characterStableId: 'character-a', displayOrder: 0, role: 'primary' }],
        false,
      ),
    ).toEqual([])
    expect(
      validatePrototypeCharacters(
        [
          { characterStableId: 'character-a', displayOrder: 0, role: 'primary' },
          { characterStableId: 'character-b', displayOrder: 1, role: 'secondary' },
        ],
        true,
      ),
    ).toEqual([])

    expect(validatePrototypeCharacters([], false)).toEqual(
      expect.arrayContaining([
        'at least one character is required',
        'exactly one primary character is required',
      ]),
    )
    expect(
      validatePrototypeCharacters(
        [
          { characterStableId: 'character-a', displayOrder: 0, role: 'primary' },
          { characterStableId: 'character-a', displayOrder: 0, role: 'secondary' },
        ],
        false,
      ),
    ).toEqual(
      expect.arrayContaining([
        'multiple characters require isGroup=true',
        'character relationships must be unique',
        'displayOrder must be unique within a prototype',
      ]),
    )
  })
})

describe('catalog errors', () => {
  it('retains stable error codes and structured conflict details', () => {
    expect(CATALOG_ERROR_CODES).toContain('CATALOG_VERSION_CONFLICT')
    expect(CATALOG_ERROR_CODES).toContain('FORMAL_MAIN_IMAGE_CAPABILITY_NOT_AVAILABLE')
    expect(CATALOG_ERROR_CODES).toContain('MERGE_CAPABILITY_NOT_AVAILABLE')

    const error = new CatalogDomainError(
      'CATALOG_VERSION_CONFLICT',
      'Synthetic version conflict.',
      'conflict',
      { actualVersion: 3, expectedVersion: 2 },
    )
    expect(error).toMatchObject({
      code: 'CATALOG_VERSION_CONFLICT',
      details: { actualVersion: 3, expectedVersion: 2 },
      kind: 'conflict',
      name: 'CatalogDomainError',
    })
  })
})
