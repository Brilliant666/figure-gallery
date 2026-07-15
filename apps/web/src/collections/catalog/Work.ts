import { WORK_PUBLICATION_STATUSES, WORK_TYPES } from '@figure-gallery/domain-contracts'
import type { CollectionConfig } from 'payload'

import {
  attributionFields,
  catalogCollection,
  lockVersionField,
  selectOptions,
  softDeleteFields,
  stableIdField,
} from './common'

export const Work: CollectionConfig = catalogCollection({
  slug: 'works',
  dbName: 'works',
  admin: {
    defaultColumns: ['displayName', 'workType', 'publicationStatus', 'lockVersion'],
    group: 'Catalog',
    useAsTitle: 'displayName',
  },
  fields: [
    stableIdField(),
    {
      name: 'displayName',
      type: 'text',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'originalName',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'normalizedName',
      type: 'text',
      admin: { readOnly: true },
      index: true,
      required: true,
    },
    {
      name: 'workType',
      type: 'select',
      admin: { readOnly: true },
      defaultValue: 'other',
      enumName: 'enum_works_work_type',
      options: selectOptions(WORK_TYPES),
      required: true,
    },
    {
      name: 'publicationStatus',
      type: 'select',
      admin: { readOnly: true },
      defaultValue: 'draft',
      enumName: 'enum_works_publication_status',
      options: selectOptions(WORK_PUBLICATION_STATUSES),
      required: true,
    },
    lockVersionField(),
    ...attributionFields(),
    ...softDeleteFields(),
  ],
})
