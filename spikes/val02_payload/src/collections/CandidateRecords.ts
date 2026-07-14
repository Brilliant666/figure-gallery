import type { CollectionConfig } from 'payload'

import { candidateUpsertEndpoint } from '@/endpoints/candidateUpsert'
import { candidateReviewEndpoint } from '@/endpoints/candidateReview'
import { adminFieldOnly, adminOnly } from '@/security/roles'

export const CandidateRecords: CollectionConfig = {
  slug: 'candidate-records',
  admin: {
    defaultColumns: ['rawTitle', 'status', 'matchState', 'updatedAt'],
    useAsTitle: 'rawTitle',
  },
  access: {
    create: () => false,
    delete: () => false,
    read: adminOnly,
    update: () => false,
  },
  endpoints: [candidateUpsertEndpoint, candidateReviewEndpoint],
  trash: true,
  versions: { maxPerDoc: 30 },
  fields: [
    { name: 'externalKey', type: 'text', index: true, required: true, unique: true },
    {
      name: 'source',
      type: 'relationship',
      relationTo: 'source-records',
      required: true,
      unique: true,
    },
    { name: 'rawTitle', type: 'text', required: true },
    { name: 'rawCharacterNames', type: 'text', hasMany: true },
    { name: 'rawWorkName', type: 'text' },
    { name: 'rawManufacturer', type: 'text' },
    { name: 'rawCategory', type: 'text' },
    { name: 'rawScale', type: 'text' },
    { name: 'rawDate', type: 'text' },
    { name: 'rawSnapshot', type: 'json', required: true },
    {
      name: 'status',
      type: 'select',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      defaultValue: 'pending',
      options: ['pending', 'accepted', 'deferred', 'ignored', 'merged', 'update_pending'],
      required: true,
    },
    {
      name: 'reason',
      type: 'textarea',
      access: { create: adminFieldOnly, update: adminFieldOnly },
    },
    {
      name: 'matchState',
      type: 'select',
      defaultValue: 'character_pending',
      options: ['character_pending', 'manufacturer_pending', 'matched'],
      required: true,
    },
    { name: 'proposedManufacturerStatus', type: 'select', options: ['draft', 'active', 'hidden'] },
    { name: 'requestedChanges', type: 'json' },
    {
      name: 'acceptedFields',
      type: 'json',
      access: { create: adminFieldOnly, update: adminFieldOnly },
    },
    {
      name: 'rejectedFields',
      type: 'json',
      access: { create: adminFieldOnly, update: adminFieldOnly },
    },
    {
      name: 'targetPrototype',
      type: 'relationship',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      relationTo: 'figure-prototypes',
    },
    {
      name: 'targetVersion',
      type: 'relationship',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      relationTo: 'figure-versions',
    },
    {
      name: 'images',
      type: 'relationship',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      hasMany: true,
      relationTo: 'media',
    },
  ],
}
