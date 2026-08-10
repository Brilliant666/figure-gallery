import type { FieldHook, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { immutableTextField } from '../../src/collections/catalog/common'
import { withCatalogDomainWrite } from '../../src/domain/catalog/internal-context'

function immutableHook(fieldName: string, required = true): FieldHook {
  const field = immutableTextField(fieldName, { required }) as {
    hooks?: { beforeValidate?: FieldHook[] }
  }
  const hook = field.hooks?.beforeValidate?.[0]
  if (!hook) throw new Error(`Missing immutable hook for ${fieldName}.`)
  return hook
}

function hookArgs(
  req: PayloadRequest,
  operation: 'create' | 'update',
  value: unknown,
  previousValue?: unknown,
): Parameters<FieldHook>[0] {
  return { operation, previousValue, req, value } as Parameters<FieldHook>[0]
}

describe('immutable catalog text fields', () => {
  it('keeps required stable keys unique, indexed, and read-only', () => {
    expect(immutableTextField('catalogItemKey', { maxLength: 255 })).toMatchObject({
      admin: { readOnly: true },
      index: true,
      maxLength: 255,
      name: 'catalogItemKey',
      required: true,
      type: 'text',
      unique: true,
    })
  })

  it('permits one-time assignment for nullable legacy projection keys', async () => {
    const req = {} as PayloadRequest
    const hook = immutableHook('projectionKey', false)

    await withCatalogDomainWrite(req, async () => {
      expect(hook(hookArgs(req, 'update', 'rem-proto-0001', null))).toBe('rem-proto-0001')
    })
  })

  it('rejects stable-key replacement and clearing after assignment', async () => {
    const req = {} as PayloadRequest
    const hook = immutableHook('sourceRecordKey')

    await withCatalogDomainWrite(req, async () => {
      expect(hook(hookArgs(req, 'update', undefined, 'goodsmile:url:abc'))).toBe(
        'goodsmile:url:abc',
      )
      for (const nextValue of ['goodsmile:url:def', null]) {
        let caught: unknown
        try {
          hook(hookArgs(req, 'update', nextValue, 'goodsmile:url:abc'))
        } catch (error) {
          caught = error
        }
        expect(caught).toMatchObject({
          data: {
            errors: [{ message: 'sourceRecordKey is immutable.', path: 'sourceRecordKey' }],
          },
        })
      }
    })
  })

  it('keeps the private catalog write capability mandatory', () => {
    const req = {} as PayloadRequest
    const hook = immutableHook('catalogItemKey')

    expect(() => hook(hookArgs(req, 'create', 'solaris:123'))).toThrow(
      'Formal catalog writes must use the catalog domain service.',
    )
  })
})
