import type { CollectionConfig } from 'payload'

import { isAdminUser, isPublicReadEnabled } from '@/security/roles'

export const Works: CollectionConfig = {
  slug: 'works',
  admin: { useAsTitle: 'name' },
  access: {
    create: () => false,
    delete: () => false,
    read: async ({ req }) => isAdminUser(req.user) || (await isPublicReadEnabled(req)),
    update: () => false,
  },
  trash: true,
  versions: { drafts: true, maxPerDoc: 20 },
  fields: [
    { name: 'fixtureID', type: 'text', index: true, unique: true },
    { name: 'name', type: 'text', required: true },
    { name: 'originalName', type: 'text' },
    { name: 'aliases', type: 'text', hasMany: true },
  ],
}
