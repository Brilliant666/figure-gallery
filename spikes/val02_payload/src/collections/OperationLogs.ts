import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/security/roles'

export const OperationLogs: CollectionConfig = {
  slug: 'operation-logs',
  admin: { defaultColumns: ['operationType', 'actorLabel', 'createdAt', 'undone'] },
  access: { create: () => false, delete: () => false, read: adminOnly, update: () => false },
  fields: [
    { name: 'fixtureID', type: 'text', index: true, unique: true },
    { name: 'actor', type: 'relationship', relationTo: 'users' },
    { name: 'actorLabel', type: 'text', required: true },
    {
      name: 'operationType',
      type: 'select',
      options: [
        'candidate_upsert',
        'create_manufacturer',
        'create_prototype',
        'attach_version',
        'accept_field',
        'reject_field',
        'defer_candidate',
        'ignore_candidate',
        'set_manufacturer_status',
        'set_prototype_publication',
        'select_main_image',
        'update_settings',
        'merge',
        'split',
        'undo_merge',
        'undo_split',
      ],
      required: true,
    },
    { name: 'reason', type: 'textarea', required: true },
    { name: 'beforeState', type: 'json', required: true },
    { name: 'afterState', type: 'json', required: true },
    { name: 'relatedRecords', type: 'json', required: true },
    { name: 'inversePayload', type: 'json' },
    { name: 'undone', type: 'checkbox', defaultValue: false, required: true },
  ],
}
