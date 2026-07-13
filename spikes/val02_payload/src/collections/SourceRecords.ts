import type { CollectionConfig } from 'payload'

import { deriveSourceIdentity } from '@/hooks/sourceBoundary'
import {
  adminFieldOnly,
  adminOnly,
} from '@/security/roles'

export const SourceRecords: CollectionConfig = {
  slug: 'source-records',
  admin: { defaultColumns: ['sourceType', 'sourceItemId', 'status', 'invalidated'] },
  access: {
    create: () => false,
    delete: () => false,
    read: adminOnly,
    update: () => false,
  },
  hooks: { beforeChange: [deriveSourceIdentity] },
  trash: true,
  fields: [
    { name: 'fixtureID', type: 'text', index: true, unique: true },
    { name: 'candidateOnly', type: 'checkbox', defaultValue: true, required: true },
    {
      name: 'candidateOwner',
      type: 'relationship',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      relationTo: 'users',
    },
    { name: 'sourceType', type: 'text', index: true, required: true },
    { name: 'sourceItemId', type: 'text', index: true },
    { name: 'sourceUrl', type: 'text', required: true },
    { name: 'canonicalUrl', type: 'text', index: true, required: true },
    { name: 'sourceKey', type: 'text', index: true, required: true, unique: true },
    { name: 'status', type: 'select', options: ['active', 'missing', 'blocked'], required: true },
    { name: 'lastSyncedAt', type: 'date' },
    { name: 'invalidated', type: 'checkbox', defaultValue: false, required: true },
    { name: 'rawSnapshot', type: 'json', required: true },
    {
      name: 'prototype',
      type: 'relationship',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      relationTo: 'figure-prototypes',
    },
  ],
}
