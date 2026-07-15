import { CHARACTER_STATUSES } from '@figure-gallery/domain-contracts'
import type { CollectionConfig } from 'payload'

import {
  attributionFields,
  catalogCollection,
  catalogRelationTo,
  lockVersionField,
  selectOptions,
  softDeleteFields,
  stableIdField,
} from './common'

export const Character: CollectionConfig = catalogCollection({
  slug: 'characters',
  dbName: 'characters',
  admin: {
    defaultColumns: ['displayName', 'work', 'status', 'lockVersion'],
    group: 'Catalog',
    useAsTitle: 'displayName',
  },
  fields: [
    stableIdField(),
    {
      name: 'work',
      type: 'relationship',
      admin: { readOnly: true },
      index: true,
      relationTo: catalogRelationTo('works'),
    },
    {
      name: 'displayName',
      type: 'text',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'nameZh',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'nameJa',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'nameEn',
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
      name: 'searchDocument',
      type: 'textarea',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      admin: { readOnly: true },
      defaultValue: 'matching_pending',
      enumName: 'enum_characters_status',
      options: selectOptions(CHARACTER_STATUSES),
      required: true,
    },
    lockVersionField(),
    ...attributionFields(),
    ...softDeleteFields(),
  ],
})
