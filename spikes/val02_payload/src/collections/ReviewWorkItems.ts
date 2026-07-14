import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/security/roles'

export const ReviewWorkItems: CollectionConfig = {
  slug: 'review-work-items',
  admin: {
    defaultColumns: ['candidate', 'status', 'reviewer', 'lockVersion', 'updatedAt'],
    useAsTitle: 'id',
  },
  access: {
    create: () => false,
    delete: () => false,
    read: adminOnly,
    update: () => false,
  },
  trash: true,
  fields: [
    {
      name: 'candidate',
      type: 'relationship',
      relationTo: 'candidate-records',
      required: true,
    },
    {
      name: 'allowedTargets',
      type: 'relationship',
      hasMany: true,
      relationTo: 'figure-prototypes',
    },
    { name: 'reviewer', type: 'relationship', relationTo: 'users', required: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'open',
      options: ['open', 'completed', 'cancelled'],
      required: true,
    },
    { name: 'lockVersion', type: 'number', defaultValue: 1, min: 1, required: true },
    { name: 'startedAt', type: 'date', required: true },
    { name: 'completedAt', type: 'date' },
    { name: 'decisionReason', type: 'textarea' },
  ],
}
