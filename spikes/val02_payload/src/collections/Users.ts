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
    update: adminOnly,
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
    {
      name: 'candidateClientID',
      type: 'text',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      admin: { description: 'Stable runtime-provisioned client identity; not a credential.' },
      index: true,
      unique: true,
    },
    {
      name: 'candidateActive',
      type: 'checkbox',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      defaultValue: true,
      required: true,
    },
    {
      name: 'candidateTokenHash',
      type: 'text',
      access: { create: adminFieldOnly, read: adminFieldOnly, update: adminFieldOnly },
      admin: { hidden: true },
      index: true,
      unique: true,
    },
  ],
}
