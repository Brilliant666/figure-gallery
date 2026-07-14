import type { CollectionConfig, Where } from 'payload'

import { isAdminUser, isPublicReadEnabled } from '@/security/roles'

export const Characters: CollectionConfig = {
  slug: 'characters',
  admin: { defaultColumns: ['displayName', 'work', 'status'], useAsTitle: 'displayName' },
  access: {
    create: () => false,
    delete: () => false,
    read: async ({ req }) => {
      if (isAdminUser(req.user)) return true
      if (!(await isPublicReadEnabled(req))) return false
      return { and: [{ status: { equals: 'active' } }, { softDeleted: { equals: false } }] } as Where
    },
    update: () => false,
  },
  trash: true,
  versions: { drafts: true, maxPerDoc: 20 },
  fields: [
    { name: 'fixtureID', type: 'text', index: true, unique: true },
    { name: 'displayName', type: 'text', index: true, required: true },
    { name: 'nameZh', type: 'text', index: true },
    { name: 'nameJa', type: 'text', index: true },
    { name: 'nameEn', type: 'text', index: true },
    { name: 'aliases', type: 'text', hasMany: true, index: true },
    { name: 'work', type: 'relationship', relationTo: 'works' },
    {
      name: 'status',
      type: 'select',
      enumName: 'enum_characters_domain_status',
      defaultValue: 'active',
      options: ['active', 'hidden', 'matching-pending'],
      required: true,
    },
    { name: 'softDeleted', type: 'checkbox', defaultValue: false, required: true },
  ],
}
