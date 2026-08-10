import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assignPrototypeIdentities,
  legacyMembershipPrototypeId,
  membershipFingerprint,
  resolvePrototypeAlias,
} from '../../src/projection/prototype-identity.js'

test('membership fingerprint changes while a persisted anchor keeps Prototype identity stable', () => {
  const initialIds = ['catalog-a']
  const initialFingerprint = membershipFingerprint(initialIds)
  const initialId = legacyMembershipPrototypeId(initialIds)
  const initial = assignPrototypeIdentities({
    groups: [{ catalogItemIds: initialIds }],
    bootstrapPrototypeIds: { [initialFingerprint]: initialId },
  })
  const expanded = assignPrototypeIdentities({
    groups: [{ catalogItemIds: ['catalog-a', 'catalog-a-color'] }],
    previousRegistry: initial.registry,
  })
  const entry = Object.values(expanded.registry.prototypes)[0]

  assert.equal(entry.prototypeId, initialId)
  assert.notEqual(entry.membershipFingerprint, initialFingerprint)
  assert.equal(entry.anchorCatalogItemId, 'catalog-a')
})

test('retired aliases resolve to one active survivor and remain stable on rebuild', () => {
  const ids = ['catalog-a', 'catalog-b']
  const fingerprint = membershipFingerprint(ids)
  const survivor = 'rem-proto-1111111111111111'
  const retired = 'rem-proto-2222222222222222'
  const first = assignPrototypeIdentities({
    groups: [{ catalogItemIds: ids }],
    forcedPrototypeIds: { [fingerprint]: survivor },
    aliases: { [retired]: survivor },
  })
  const second = assignPrototypeIdentities({
    groups: [{ catalogItemIds: [...ids].reverse() }],
    previousRegistry: first.registry,
    forcedPrototypeIds: { [fingerprint]: survivor },
    aliases: { [retired]: survivor },
  })

  assert.equal(resolvePrototypeAlias(retired, second.registry.aliases), survivor)
  assert.deepEqual(second.registry, first.registry)
  assert.throws(
    () => resolvePrototypeAlias('rem-proto-a', {
      'rem-proto-a': 'rem-proto-b',
      'rem-proto-b': 'rem-proto-a',
    }),
    /alias cycle/u,
  )
})

test('a genuinely new group receives an anchor identity that is persisted', () => {
  const existingIds = ['catalog-a']
  const existingFingerprint = membershipFingerprint(existingIds)
  const existingId = legacyMembershipPrototypeId(existingIds)
  const initial = assignPrototypeIdentities({
    groups: [{ catalogItemIds: existingIds }],
    bootstrapPrototypeIds: { [existingFingerprint]: existingId },
  })
  const expanded = assignPrototypeIdentities({
    groups: [{ catalogItemIds: existingIds }, { catalogItemIds: ['catalog-new'] }],
    previousRegistry: initial.registry,
  })
  const rebuilt = assignPrototypeIdentities({
    groups: [{ catalogItemIds: ['catalog-new'] }, { catalogItemIds: existingIds }],
    previousRegistry: expanded.registry,
  })
  const newEntry = Object.values(expanded.registry.prototypes).find((entry) => (
    entry.anchorCatalogItemId === 'catalog-new'
  ))

  assert.match(newEntry.prototypeId, /^rem-proto-[a-f\d]{16}$/u)
  assert.notEqual(newEntry.prototypeId, legacyMembershipPrototypeId(['catalog-new']))
  assert.deepEqual(rebuilt.registry, expanded.registry)
})

test('an implicit split is rejected instead of silently reusing identity', () => {
  const ids = ['catalog-a', 'catalog-b']
  const fingerprint = membershipFingerprint(ids)
  const initial = assignPrototypeIdentities({
    groups: [{ catalogItemIds: ids }],
    bootstrapPrototypeIds: { [fingerprint]: 'rem-proto-1111111111111111' },
  })
  assert.throws(
    () => assignPrototypeIdentities({
      groups: [{ catalogItemIds: ['catalog-a'] }, { catalogItemIds: ['catalog-b'] }],
      previousRegistry: initial.registry,
    }),
    /split requires an explicit identity decision/u,
  )
})
