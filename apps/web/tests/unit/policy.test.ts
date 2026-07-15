import { describe, expect, it } from 'vitest'

import { buildTechnicalMediaCollection } from '../../src/collections/Media'
import { denyAnonymousTechnicalUserCreation, Users } from '../../src/collections/Users'
import { GRAPHQL_POLICY } from '../../src/config/payload-policy'

const invokeAccess = async (access: unknown, user: unknown): Promise<unknown> => {
  if (typeof access !== 'function') throw new Error('access rule is not callable')
  return access({ req: { user } })
}

describe('technical collection and API policy', () => {
  it('closes production GraphQL introspection and playground', () => {
    expect(GRAPHQL_POLICY).toEqual({
      disableIntrospectionInProduction: true,
      disablePlaygroundInProduction: true,
    })
  })

  it.each(['create', 'read', 'update', 'delete'] as const)(
    'denies anonymous %s on the technical Users collection',
    async (operation) => {
      expect(await invokeAccess(Users.access?.[operation], null)).toBe(false)
      expect(await invokeAccess(Users.access?.[operation], { id: 'synthetic-admin' })).toBe(true)
    },
  )

  it('blocks the anonymous first-user override path', () => {
    expect(() =>
      denyAnonymousTechnicalUserCreation({ operation: 'create', req: { user: null } } as never),
    ).toThrow()
    expect(() =>
      denyAnonymousTechnicalUserCreation({
        operation: 'create',
        req: { user: { id: 'synthetic-admin' } },
      } as never),
    ).not.toThrow()
  })

  it.each(['create', 'read', 'update', 'delete'] as const)(
    'denies anonymous %s on infrastructure Media',
    async (operation) => {
      const media = buildTechnicalMediaCollection('.runtime/media')
      expect(await invokeAccess(media.access?.[operation], null)).toBe(false)
      expect(await invokeAccess(media.access?.[operation], { id: 'synthetic-admin' })).toBe(true)
    },
  )
})
