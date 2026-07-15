import { randomUUID } from 'node:crypto'
import {
  ValidationError,
  type Access,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type CollectionSlug,
  type Field,
  type FieldHook,
} from 'payload'

import {
  assertCatalogDomainWrite,
  denyCatalogGenericWrite,
} from '../../domain/catalog/internal-context'

const adminRead: Access = ({ req }) => req.user?.collection === 'users'
const denyWrite: Access = () => false

export const catalogRelationTo = (slug: string): CollectionSlug => slug as CollectionSlug

export const selectOptions = (values: readonly string[]) =>
  values.map((value) => ({ label: value, value }))

const setStableId: FieldHook = ({ operation, previousValue, req, value }) => {
  if (operation === 'create') {
    assertCatalogDomainWrite(req)
    return randomUUID()
  }

  if (operation === 'update') {
    assertCatalogDomainWrite(req)
    if (value !== undefined && previousValue !== undefined && value !== previousValue) {
      throw new ValidationError({
        errors: [{ message: 'stableId is immutable.', path: 'stableId' }],
        req,
      })
    }
    return previousValue
  }

  return value
}

export const stableIdField = (): Field => ({
  name: 'stableId',
  type: 'text',
  admin: {
    readOnly: true,
  },
  hooks: {
    beforeValidate: [setStableId],
  },
  index: true,
  maxLength: 36,
  minLength: 36,
  required: true,
  unique: true,
})

export const immutableUuidField = (name: string): Field => ({
  name,
  type: 'text',
  admin: {
    readOnly: true,
  },
  index: true,
  maxLength: 36,
  minLength: 36,
  required: true,
  unique: true,
})

export const lockVersionField = (): Field => ({
  name: 'lockVersion',
  type: 'number',
  admin: {
    readOnly: true,
  },
  defaultValue: 1,
  min: 1,
  required: true,
})

export const actorField = (name: string, required = true): Field => ({
  name,
  type: 'relationship',
  admin: {
    readOnly: true,
  },
  relationTo: catalogRelationTo('users'),
  required,
})

export const attributionFields = (): Field[] => [actorField('createdBy'), actorField('updatedBy')]

export const softDeleteFields = (): Field[] => [
  {
    name: 'deletedAt',
    type: 'date',
    admin: {
      readOnly: true,
    },
  },
  actorField('deletedBy', false),
  {
    name: 'deleteReason',
    type: 'textarea',
    admin: {
      readOnly: true,
    },
  },
]

export const archiveFields = (): Field[] => [
  {
    name: 'archivedAt',
    type: 'date',
    admin: {
      readOnly: true,
    },
  },
  actorField('archivedBy', false),
  {
    name: 'archiveReason',
    type: 'textarea',
    admin: {
      readOnly: true,
    },
  },
]

export function catalogCollection(
  config: Omit<
    CollectionConfig,
    'access' | 'disableBulkDelete' | 'disableBulkEdit' | 'disableDuplicate' | 'graphQL' | 'hooks'
  > & {
    hooks?: CollectionConfig['hooks']
  },
): CollectionConfig {
  const beforeChange: CollectionBeforeChangeHook[] = config.hooks?.beforeChange ?? []

  return {
    ...config,
    access: {
      admin: ({ req }) => req.user?.collection === 'users',
      create: denyWrite,
      delete: denyWrite,
      read: adminRead,
      update: denyWrite,
    },
    disableBulkDelete: true,
    disableBulkEdit: true,
    disableDuplicate: true,
    graphQL: {
      disableMutations: true,
    },
    hooks: {
      ...config.hooks,
      beforeChange,
      beforeOperation: [denyCatalogGenericWrite],
    },
    timestamps: config.timestamps ?? true,
    trash: false,
    versions: false,
  }
}
