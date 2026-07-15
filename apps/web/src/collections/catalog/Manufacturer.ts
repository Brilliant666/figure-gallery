import { MANUFACTURER_STATUSES } from '@figure-gallery/domain-contracts'
import type { CollectionConfig } from 'payload'

import {
  attributionFields,
  catalogCollection,
  lockVersionField,
  selectOptions,
  softDeleteFields,
  stableIdField,
} from './common'

export const Manufacturer: CollectionConfig = catalogCollection({
  slug: 'manufacturers',
  dbName: 'manufacturers',
  admin: {
    defaultColumns: ['canonicalName', 'status', 'lockVersion'],
    group: 'Catalog',
    useAsTitle: 'canonicalName',
  },
  fields: [
    stableIdField(),
    {
      name: 'canonicalName',
      type: 'text',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'normalizedName',
      type: 'text',
      admin: { readOnly: true },
      index: true,
      required: true,
    },
    {
      name: 'aliases',
      type: 'array',
      admin: { readOnly: true },
      fields: [
        {
          name: 'value',
          type: 'text',
          admin: { readOnly: true },
          required: true,
        },
        {
          name: 'normalizedValue',
          type: 'text',
          admin: { readOnly: true },
          required: true,
        },
        {
          name: 'locale',
          type: 'text',
          admin: { readOnly: true },
          maxLength: 35,
        },
      ],
    },
    {
      name: 'officialSiteUrl',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'authorizationNote',
      type: 'textarea',
      admin: { readOnly: true },
    },
    {
      name: 'sourceEvidence',
      type: 'json',
      admin: { readOnly: true },
    },
    {
      name: 'status',
      type: 'select',
      admin: { readOnly: true },
      defaultValue: 'draft',
      enumName: 'enum_manufacturers_status',
      options: selectOptions(MANUFACTURER_STATUSES),
      required: true,
    },
    lockVersionField(),
    ...attributionFields(),
    ...softDeleteFields(),
  ],
})
