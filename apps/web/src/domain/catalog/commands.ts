import {
  CHARACTER_ALIAS_TYPES,
  CHARACTER_STATUSES,
  FIGURE_RELEASE_STATUSES,
  FIGURE_TYPES,
  FIGURE_VERSION_KINDS,
  GRAY_MODEL_COMPLETENESS,
  MANUFACTURER_STATUSES,
  PROTOTYPE_AUTHORIZATION_STATUSES,
  PROTOTYPE_CHARACTER_ROLES,
  PROTOTYPE_INCLUSION_STATUSES,
  PROTOTYPE_PUBLICATION_STATUSES,
  WORK_PUBLICATION_STATUSES,
  WORK_TYPES,
  CatalogDomainError,
  type CatalogCommand,
} from '@figure-gallery/domain-contracts'

type CommandType = CatalogCommand['type']
type Rule = {
  allowed: readonly string[]
  required: readonly string[]
}

const COMMON_CREATE = ['operationId', 'reason', 'type'] as const
const COMMON_UPDATE = [...COMMON_CREATE, 'expectedVersion', 'stableId'] as const

const RULES: Record<CommandType, Rule> = {
  createWork: {
    allowed: [...COMMON_CREATE, 'displayName', 'originalName', 'workType'],
    required: [...COMMON_CREATE, 'displayName'],
  },
  updateWork: {
    allowed: [...COMMON_UPDATE, 'displayName', 'originalName', 'workType'],
    required: COMMON_UPDATE,
  },
  setWorkPublicationStatus: {
    allowed: [...COMMON_UPDATE, 'publicationStatus'],
    required: [...COMMON_UPDATE, 'publicationStatus'],
  },
  softDeleteWork: { allowed: COMMON_UPDATE, required: COMMON_UPDATE },
  restoreWork: { allowed: COMMON_UPDATE, required: COMMON_UPDATE },
  createCharacter: {
    allowed: [...COMMON_CREATE, 'displayName', 'nameEn', 'nameJa', 'nameZh', 'status', 'workStableId'],
    required: [...COMMON_CREATE, 'displayName'],
  },
  updateCharacter: {
    allowed: [...COMMON_UPDATE, 'displayName', 'nameEn', 'nameJa', 'nameZh', 'workStableId'],
    required: COMMON_UPDATE,
  },
  addCharacterAlias: {
    allowed: [...COMMON_UPDATE, 'aliasType', 'isPreferred', 'locale', 'value'],
    required: [...COMMON_UPDATE, 'aliasType', 'value'],
  },
  updateCharacterAlias: {
    allowed: [...COMMON_UPDATE, 'aliasStableId', 'aliasType', 'isPreferred', 'locale', 'value'],
    required: [...COMMON_UPDATE, 'aliasStableId'],
  },
  removeCharacterAlias: {
    allowed: [...COMMON_UPDATE, 'aliasStableId'],
    required: [...COMMON_UPDATE, 'aliasStableId'],
  },
  setCharacterStatus: {
    allowed: [...COMMON_UPDATE, 'status'],
    required: [...COMMON_UPDATE, 'status'],
  },
  softDeleteCharacter: { allowed: COMMON_UPDATE, required: COMMON_UPDATE },
  restoreCharacter: { allowed: COMMON_UPDATE, required: COMMON_UPDATE },
  createManufacturer: {
    allowed: [
      ...COMMON_CREATE,
      'aliases',
      'authorizationNote',
      'canonicalName',
      'officialSiteUrl',
      'sourceEvidence',
    ],
    required: [...COMMON_CREATE, 'canonicalName'],
  },
  updateManufacturer: {
    allowed: [
      ...COMMON_UPDATE,
      'aliases',
      'authorizationNote',
      'canonicalName',
      'officialSiteUrl',
      'sourceEvidence',
    ],
    required: COMMON_UPDATE,
  },
  setManufacturerStatus: {
    allowed: [...COMMON_UPDATE, 'status'],
    required: [...COMMON_UPDATE, 'status'],
  },
  softDeleteManufacturer: { allowed: COMMON_UPDATE, required: COMMON_UPDATE },
  restoreManufacturer: { allowed: COMMON_UPDATE, required: COMMON_UPDATE },
  createFigurePrototype: {
    allowed: [
      ...COMMON_CREATE,
      'characters',
      'costumeText',
      'figureType',
      'isGroup',
      'manufacturerStableId',
      'scale',
      'title',
      'workStableId',
    ],
    required: [
      ...COMMON_CREATE,
      'characters',
      'figureType',
      'isGroup',
      'manufacturerStableId',
      'title',
    ],
  },
  updateFigurePrototype: {
    allowed: [
      ...COMMON_UPDATE,
      'costumeText',
      'figureType',
      'manufacturerStableId',
      'scale',
      'title',
      'workStableId',
    ],
    required: COMMON_UPDATE,
  },
  setPrototypeCharacters: {
    allowed: [...COMMON_UPDATE, 'characters', 'isGroup'],
    required: [...COMMON_UPDATE, 'characters', 'isGroup'],
  },
  reviewPrototypeAuthorization: {
    allowed: [...COMMON_UPDATE, 'authorizationEvidence', 'authorizationStatus'],
    required: [...COMMON_UPDATE, 'authorizationStatus'],
  },
  reviewPrototypeInclusion: {
    allowed: [...COMMON_UPDATE, 'inclusionStatus'],
    required: [...COMMON_UPDATE, 'inclusionStatus'],
  },
  setPrototypePublicationStatus: {
    allowed: [...COMMON_UPDATE, 'publicationStatus'],
    required: [...COMMON_UPDATE, 'publicationStatus'],
  },
  archivePrototype: { allowed: COMMON_UPDATE, required: COMMON_UPDATE },
  restorePrototype: { allowed: COMMON_UPDATE, required: COMMON_UPDATE },
  createFigureVersion: {
    allowed: [
      ...COMMON_CREATE,
      'channelOrDistributorLabel',
      'grayModelCompleteness',
      'kind',
      'name',
      'notes',
      'prototypeStableId',
      'releaseDate',
      'releaseStatus',
      'skuOrCode',
    ],
    required: [
      ...COMMON_CREATE,
      'grayModelCompleteness',
      'kind',
      'name',
      'prototypeStableId',
      'releaseStatus',
    ],
  },
  updateFigureVersion: {
    allowed: [
      ...COMMON_UPDATE,
      'channelOrDistributorLabel',
      'grayModelCompleteness',
      'kind',
      'name',
      'notes',
      'releaseDate',
      'releaseStatus',
      'skuOrCode',
    ],
    required: COMMON_UPDATE,
  },
  softDeleteFigureVersion: { allowed: COMMON_UPDATE, required: COMMON_UPDATE },
  restoreFigureVersion: { allowed: COMMON_UPDATE, required: COMMON_UPDATE },
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function invalid(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new CatalogDomainError('CATALOG_COMMAND_INVALID', message, 'validation', details)
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Command body must be an object.')
  return value as Record<string, unknown>
}

function requireString(record: Record<string, unknown>, key: string, options?: { nullable?: boolean }): void {
  const value = record[key]
  if (value === undefined || (options?.nullable && value === null)) return
  if (typeof value !== 'string') invalid(`${key} must be a string.`, { field: key })
}

function requireBoolean(record: Record<string, unknown>, key: string): void {
  if (record[key] !== undefined && typeof record[key] !== 'boolean') {
    invalid(`${key} must be a boolean.`, { field: key })
  }
}

function requireEnum(
  record: Record<string, unknown>,
  key: string,
  values: readonly string[],
  options?: { nullable?: boolean },
): void {
  if (record[key] === undefined || (options?.nullable && record[key] === null)) return
  if (!values.includes(String(record[key]))) {
    invalid(`${key} is not an allowed value.`, { allowed: values, field: key })
  }
}

function requireUuid(
  record: Record<string, unknown>,
  key: string,
  options?: { nullable?: boolean },
): void {
  if (options?.nullable && record[key] === null) return
  if (record[key] !== undefined && (typeof record[key] !== 'string' || !UUID_PATTERN.test(record[key]))) {
    invalid(`${key} must be a UUID.`, { field: key })
  }
}

function validateAliases(record: Record<string, unknown>): void {
  const aliases = record.aliases
  if (aliases === undefined) return
  if (!Array.isArray(aliases)) invalid('aliases must be an array.', { field: 'aliases' })
  for (const alias of aliases) {
    const item = requireRecord(alias)
    if (Object.keys(item).some((key) => !['locale', 'value'].includes(key))) {
      invalid('Manufacturer alias contains an unknown field.')
    }
    if (typeof item.value !== 'string' || !item.value.trim()) invalid('Alias value is required.')
    requireString(item, 'locale')
  }
}

function validateCharacters(record: Record<string, unknown>): void {
  const characters = record.characters
  if (characters === undefined) return
  if (!Array.isArray(characters)) invalid('characters must be an array.', { field: 'characters' })
  for (const character of characters) {
    const item = requireRecord(character)
    const allowed = ['characterStableId', 'displayOrder', 'role']
    if (Object.keys(item).some((key) => !allowed.includes(key))) {
      invalid('Prototype character contains an unknown field.')
    }
    requireUuid(item, 'characterStableId')
    if (!Number.isInteger(item.displayOrder) || Number(item.displayOrder) < 0) {
      invalid('displayOrder must be a non-negative integer.')
    }
    requireEnum(item, 'role', PROTOTYPE_CHARACTER_ROLES)
    for (const key of allowed) if (item[key] === undefined) invalid(`${key} is required.`)
  }
}

function validateJsonField(record: Record<string, unknown>, key: string): void {
  const value = record[key]
  if (value === undefined) return
  const visit = (item: unknown): boolean => {
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return true
    if (typeof item === 'number') return Number.isFinite(item)
    if (Array.isArray(item)) return item.every(visit)
    if (!item || typeof item !== 'object') return false
    const prototype = Object.getPrototypeOf(item)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Object.values(item as Record<string, unknown>).every(visit)
  }
  if (!visit(value) || JSON.stringify(value).length > 16_384) {
    invalid(`${key} must be a small JSON value.`, { field: key })
  }
}

export function parseCatalogCommand(value: unknown): CatalogCommand {
  const record = requireRecord(value)
  if (typeof record.type !== 'string' || !Object.hasOwn(RULES, record.type)) {
    invalid('Unknown catalog command type.')
  }
  const type = record.type as CommandType
  const rule = RULES[type]
  const unknownFields = Object.keys(record).filter((key) => !rule.allowed.includes(key))
  if (unknownFields.length) invalid('Command contains unknown fields.', { fields: unknownFields })
  for (const key of rule.required) if (record[key] === undefined) invalid(`${key} is required.`, { field: key })

  requireUuid(record, 'operationId')
  requireUuid(record, 'stableId')
  requireUuid(record, 'aliasStableId')
  requireUuid(record, 'workStableId', { nullable: true })
  requireUuid(record, 'manufacturerStableId')
  requireUuid(record, 'prototypeStableId')
  if (typeof record.reason !== 'string' || !record.reason.trim()) {
    throw new CatalogDomainError('CATALOG_REASON_REQUIRED', 'A non-empty reason is required.')
  }
  if (record.reason.length > 2_000) invalid('reason must not exceed 2000 characters.', { field: 'reason' })
  if ('expectedVersion' in record && (!Number.isInteger(record.expectedVersion) || Number(record.expectedVersion) < 1)) {
    invalid('expectedVersion must be a positive integer.', { field: 'expectedVersion' })
  }

  for (const key of [
    'authorizationNote',
    'canonicalName',
    'channelOrDistributorLabel',
    'costumeText',
    'displayName',
    'locale',
    'name',
    'nameEn',
    'nameJa',
    'nameZh',
    'notes',
    'officialSiteUrl',
    'originalName',
    'releaseDate',
    'scale',
    'skuOrCode',
    'title',
    'value',
  ]) {
    requireString(record, key, { nullable: true })
  }
  for (const key of ['canonicalName', 'displayName', 'name', 'title', 'value']) {
    if (rule.required.includes(key)) requireString(record, key)
  }
  for (const key of ['isGroup', 'isPreferred']) requireBoolean(record, key)
  requireEnum(record, 'workType', WORK_TYPES, { nullable: type === 'updateWork' })
  requireEnum(record, 'publicationStatus',
    type.startsWith('setWork') ? WORK_PUBLICATION_STATUSES : PROTOTYPE_PUBLICATION_STATUSES)
  requireEnum(record, 'status', type.includes('Manufacturer') ? MANUFACTURER_STATUSES : CHARACTER_STATUSES)
  requireEnum(record, 'aliasType', CHARACTER_ALIAS_TYPES)
  requireEnum(record, 'figureType', FIGURE_TYPES)
  requireEnum(record, 'authorizationStatus', PROTOTYPE_AUTHORIZATION_STATUSES.filter((item) => item !== 'pending'))
  requireEnum(record, 'inclusionStatus', PROTOTYPE_INCLUSION_STATUSES.filter((item) => item !== 'pending'))
  requireEnum(record, 'kind', FIGURE_VERSION_KINDS)
  requireEnum(record, 'releaseStatus', FIGURE_RELEASE_STATUSES)
  requireEnum(record, 'grayModelCompleteness', GRAY_MODEL_COMPLETENESS)
  if (
    typeof record.releaseDate === 'string' &&
    (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(record.releaseDate) ||
      Number.isNaN(Date.parse(record.releaseDate)))
  ) {
    invalid('releaseDate must be a valid ISO date.', { field: 'releaseDate' })
  }
  validateJsonField(record, 'authorizationEvidence')
  validateJsonField(record, 'sourceEvidence')
  validateAliases(record)
  validateCharacters(record)

  return record as CatalogCommand
}
