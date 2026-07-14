import type { CollectionConfig } from 'payload'

import { adminFieldOnly, adminOnly, isAdminUser } from '@/security/roles'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email' },
  auth: {
    useAPIKey: true,
  },
  access: {
    create: adminOnly,
    delete: adminOnly,
    read: ({ req }) =>
      isAdminUser(req.user) || (req.user ? { id: { equals: req.user.id } } : false),
    update: ({ req }) =>
      isAdminUser(req.user) || (req.user ? { id: { equals: req.user.id } } : false),
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      defaultValue: 'candidate-client',
      options: [
        { label: 'Administrator', value: 'admin' },
        { label: 'Candidate client', value: 'candidate-client' },
      ],
      required: true,
    },
  ],
}
