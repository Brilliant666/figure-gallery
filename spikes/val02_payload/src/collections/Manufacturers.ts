import type { CollectionConfig, Where } from 'payload'

import { isAdminUser, isPublicReadEnabled } from '@/security/roles'

export const Manufacturers: CollectionConfig = {
  slug: 'manufacturers',
  admin: { defaultColumns: ['canonicalName', 'status'], useAsTitle: 'canonicalName' },
  access: {
    create: () => false,
    delete: () => false,
    read: async ({ req }) => {
      if (isAdminUser(req.user)) return true
      if (!(await isPublicReadEnabled(req))) return false
      return { status: { equals: 'active' } } as Where
    },
    update: () => false,
  },
  trash: true,
  versions: { drafts: true, maxPerDoc: 20 },
  fields: [
    { name: 'fixtureID', type: 'text', index: true, unique: true },
    { name: 'canonicalName', type: 'text', index: true, required: true },
    { name: 'aliases', type: 'text', hasMany: true },
    {
      name: 'status',
      type: 'select',
      enumName: 'enum_manufacturers_domain_status',
      defaultValue: 'draft',
      options: ['draft', 'active', 'hidden'],
      required: true,
    },
  ],
}
