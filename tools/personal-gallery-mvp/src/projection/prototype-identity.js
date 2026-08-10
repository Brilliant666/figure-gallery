import { createHash } from 'node:crypto'

export const PROTOTYPE_IDENTITY_SCHEMA_VERSION = 1
export const PROTOTYPE_IDENTITY_NAMESPACE = 'figure-gallery:personal-gallery:rem:prototype:v1'

const SAFE_CHARACTER_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sortedUniqueCatalogItemIds(values) {
  const sorted = [...new Set((values || []).filter((value) => typeof value === 'string' && value))].sort()
  if (!sorted.length || sorted.length !== (values || []).length) {
    throw new Error('Prototype identity requires non-empty, unique Catalog Item IDs.')
  }
  return sorted
}

export function membershipFingerprint(catalogItemIds) {
  return sha256(JSON.stringify(sortedUniqueCatalogItemIds(catalogItemIds)))
}

export function prototypeIdentityContract(characterSlug = 'rem', overrides = {}) {
  const slug = String(characterSlug || '').trim().toLowerCase()
  if (!SAFE_CHARACTER_SLUG.test(slug)) {
    throw new Error('Prototype identity requires a safe lowercase ASCII character slug.')
  }
  const identityNamespace = String(
    overrides.identityNamespace || `figure-gallery:personal-gallery:${slug}:prototype:v1`,
  ).trim()
  const prototypeIdPrefix = String(overrides.prototypeIdPrefix || `${slug}-proto`).trim()
  if (!/^[a-z0-9][a-z0-9:._-]{0,255}$/iu.test(identityNamespace)) {
    throw new Error('Prototype identity namespace is invalid.')
  }
  if (prototypeIdPrefix !== `${slug}-proto`) {
    throw new Error('Prototype ID prefix must be scoped to the character slug.')
  }
  return Object.freeze({ characterSlug: slug, identityNamespace, prototypeIdPrefix })
}

export function legacyMembershipPrototypeId(catalogItemIds, options = {}) {
  const contract = prototypeIdentityContract(options.characterSlug || 'rem', options)
  return `${contract.prototypeIdPrefix}-${membershipFingerprint(catalogItemIds).slice(0, 16)}`
}

export function resolvePrototypeAlias(prototypeId, aliases = {}) {
  const visited = new Set()
  let current = prototypeId
  while (aliases[current]) {
    if (visited.has(current)) throw new Error(`Prototype alias cycle detected at ${current}.`)
    visited.add(current)
    current = aliases[current]
  }
  return current
}

function escaped(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function prototypeIdPattern(contract) {
  return new RegExp(`^${escaped(contract.prototypeIdPrefix)}-[a-f\\d-]+$`, 'u')
}

function normalizeRegistry(raw, contract) {
  if (!raw) return null
  if (
    raw.schemaVersion !== PROTOTYPE_IDENTITY_SCHEMA_VERSION ||
    raw.characterSlug !== contract.characterSlug ||
    (raw.identityNamespace && raw.identityNamespace !== contract.identityNamespace)
  ) {
    throw new Error(`Unsupported ${contract.characterSlug} Prototype identity registry.`)
  }
  if (!raw.prototypes || typeof raw.prototypes !== 'object' || Array.isArray(raw.prototypes)) {
    throw new Error('Prototype identity registry requires a prototypes object.')
  }
  const aliases = raw.aliases && typeof raw.aliases === 'object' && !Array.isArray(raw.aliases)
    ? { ...raw.aliases }
    : {}
  const prototypes = {}
  for (const [prototypeId, entry] of Object.entries(raw.prototypes)) {
    if (!prototypeIdPattern(contract).test(prototypeId) || entry?.prototypeId !== prototypeId) {
      throw new Error(`Invalid Prototype identity registry entry: ${prototypeId}.`)
    }
    const catalogItemIds = sortedUniqueCatalogItemIds(entry.catalogItemIds)
    if (!catalogItemIds.includes(entry.anchorCatalogItemId)) {
      throw new Error(`Prototype identity anchor is not a current member: ${prototypeId}.`)
    }
    if (entry.membershipFingerprint !== membershipFingerprint(catalogItemIds)) {
      throw new Error(`Prototype membership fingerprint mismatch: ${prototypeId}.`)
    }
    prototypes[prototypeId] = {
      prototypeId,
      anchorCatalogItemId: entry.anchorCatalogItemId,
      membershipFingerprint: entry.membershipFingerprint,
      catalogItemIds,
    }
  }
  for (const [retired, target] of Object.entries(aliases)) {
    if (
      retired === target ||
      typeof target !== 'string' ||
      !prototypeIdPattern(contract).test(retired) ||
      !prototypeIdPattern(contract).test(target)
    ) {
      throw new Error(`Invalid Prototype alias: ${retired}.`)
    }
    const resolved = resolvePrototypeAlias(retired, aliases)
    if (!prototypes[resolved]) throw new Error(`Prototype alias target is not active: ${retired}.`)
    if (prototypes[retired]) throw new Error(`Active Prototype ID cannot also be an alias: ${retired}.`)
  }
  return {
    schemaVersion: PROTOTYPE_IDENTITY_SCHEMA_VERSION,
    characterSlug: contract.characterSlug,
    identityNamespace: raw.identityNamespace || contract.identityNamespace,
    prototypes,
    aliases,
  }
}

function intersects(left, rightSet) {
  return left.some((value) => rightSet.has(value))
}

function stableAnchorPrototypeId(anchorCatalogItemId, unavailableIds, contract) {
  for (let salt = 0; salt < 1_000; salt += 1) {
    const material = `${contract.identityNamespace}\n${anchorCatalogItemId}\n${salt}`
    const candidate = `${contract.prototypeIdPrefix}-${sha256(material).slice(0, 16)}`
    if (!unavailableIds.has(candidate)) return candidate
  }
  throw new Error(`Unable to allocate a stable Prototype ID for ${anchorCatalogItemId}.`)
}

function flattenAliases(values) {
  const output = {}
  for (const retired of Object.keys(values).sort()) output[retired] = resolvePrototypeAlias(retired, values)
  return output
}

export function assignPrototypeIdentities({
  groups,
  characterSlug = 'rem',
  identityNamespace,
  prototypeIdPrefix,
  previousRegistry = null,
  bootstrapPrototypeIds = {},
  forcedPrototypeIds = {},
  aliases = {},
}) {
  const contract = prototypeIdentityContract(characterSlug, { identityNamespace, prototypeIdPrefix })
  const previous = normalizeRegistry(previousRegistry, contract)
  const normalizedGroups = groups.map((group) => {
    const catalogItemIds = sortedUniqueCatalogItemIds(group.catalogItemIds)
    return {
      catalogItemIds,
      membershipFingerprint: membershipFingerprint(catalogItemIds),
      itemSet: new Set(catalogItemIds),
    }
  }).sort((left, right) => (
    left.membershipFingerprint < right.membershipFingerprint ? -1 : 1
  ))

  if (previous) {
    for (const entry of Object.values(previous.prototypes)) {
      const overlaps = normalizedGroups.filter((group) => intersects(entry.catalogItemIds, group.itemSet))
      if (overlaps.length > 1) {
        throw new Error(`Prototype split requires an explicit identity decision: ${entry.prototypeId}.`)
      }
    }
  }

  const allAliases = flattenAliases({ ...(previous?.aliases || {}), ...aliases })
  for (const [retired, target] of Object.entries(allAliases)) {
    if (!prototypeIdPattern(contract).test(retired) || !prototypeIdPattern(contract).test(target)) {
      throw new Error(`Prototype alias is outside the ${contract.characterSlug} namespace: ${retired}.`)
    }
  }
  const previousEntries = Object.values(previous?.prototypes || {})
  const previousByFingerprint = new Map(
    previousEntries.map((entry) => [entry.membershipFingerprint, entry]),
  )
  const unavailableIds = new Set([
    ...previousEntries.map((entry) => entry.prototypeId),
    ...Object.keys(allAliases),
  ])
  const claimedIds = new Set()
  const assignments = new Map()
  const prototypes = {}

  for (const group of normalizedGroups) {
    const forced = forcedPrototypeIds[group.membershipFingerprint]
    const exact = previousByFingerprint.get(group.membershipFingerprint)
    const anchorMatches = previousEntries.filter((entry) => group.itemSet.has(entry.anchorCatalogItemId))
    const overlapMatches = previousEntries.filter((entry) => intersects(entry.catalogItemIds, group.itemSet))
    let prototypeId = forced || exact?.prototypeId || null

    if (!prototypeId && anchorMatches.length === 1) prototypeId = anchorMatches[0].prototypeId
    if (!prototypeId && anchorMatches.length > 1) {
      throw new Error('Prototype merge requires an explicit survivor identity.')
    }
    if (!prototypeId && overlapMatches.length === 1) prototypeId = overlapMatches[0].prototypeId
    if (!prototypeId && overlapMatches.length > 1) {
      throw new Error('Prototype merge requires an explicit survivor identity.')
    }
    if (!prototypeId) prototypeId = bootstrapPrototypeIds[group.membershipFingerprint] || null
    if (!prototypeId) {
      prototypeId = stableAnchorPrototypeId(group.catalogItemIds[0], unavailableIds, contract)
    }
    prototypeId = resolvePrototypeAlias(prototypeId, allAliases)

    if (!prototypeIdPattern(contract).test(prototypeId)) {
      throw new Error(`Prototype ID is outside the ${contract.characterSlug} namespace: ${prototypeId}.`)
    }
    if (claimedIds.has(prototypeId)) throw new Error(`Prototype ID assigned twice: ${prototypeId}.`)
    if (allAliases[prototypeId]) throw new Error(`Retired Prototype ID cannot be active: ${prototypeId}.`)
    claimedIds.add(prototypeId)
    unavailableIds.add(prototypeId)

    const previousEntry = previous?.prototypes?.[prototypeId]
    const anchorCatalogItemId = previousEntry && group.itemSet.has(previousEntry.anchorCatalogItemId)
      ? previousEntry.anchorCatalogItemId
      : group.catalogItemIds[0]
    const entry = {
      prototypeId,
      anchorCatalogItemId,
      membershipFingerprint: group.membershipFingerprint,
      catalogItemIds: group.catalogItemIds,
    }
    prototypes[prototypeId] = entry
    assignments.set(group.membershipFingerprint, entry)
  }

  for (const [retired, target] of Object.entries(allAliases)) {
    if (prototypes[retired]) throw new Error(`Retired Prototype ID remained active: ${retired}.`)
    if (!prototypes[target]) throw new Error(`Prototype alias target was not built: ${retired}.`)
  }

  return {
    assignments,
    registry: {
      schemaVersion: PROTOTYPE_IDENTITY_SCHEMA_VERSION,
      characterSlug: contract.characterSlug,
      identityNamespace: contract.identityNamespace,
      prototypes: Object.fromEntries(Object.entries(prototypes).sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      ))),
      aliases: allAliases,
    },
  }
}
