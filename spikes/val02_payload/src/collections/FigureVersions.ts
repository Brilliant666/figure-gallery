import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/security/roles'

export const FigureVersions: CollectionConfig = {
  slug: 'figure-versions',
  admin: { defaultColumns: ['name', 'prototype', 'kind'], useAsTitle: 'name' },
  access: { create: () => false, delete: () => false, read: adminOnly, update: () => false },
  trash: true,
  versions: { maxPerDoc: 30 },
  fields: [
    { name: 'fixtureID', type: 'text', index: true, unique: true },
    { name: 'prototype', type: 'relationship', relationTo: 'figure-prototypes', required: true },
    { name: 'name', type: 'text', required: true },
    {
      name: 'kind',
      type: 'select',
      options: ['standard', 'deluxe', 'reissue', 'bonus', 'recolor', 'channel-limited'],
      required: true,
    },
  ],
}
