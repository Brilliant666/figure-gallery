import type { CollectionConfig } from 'payload'

import {
  attributionFields,
  catalogCollection,
  catalogRelationTo,
  immutableTextField,
  lockVersionField,
  sha256HexField,
  softDeleteFields,
  stableIdField,
} from './common'

export const SourceRecord: CollectionConfig = catalogCollection({
  slug: 'source-records',
  dbName: 'source_records',
  admin: {
    defaultColumns: ['sourceFamily', 'sourceRecordKey', 'catalogItem', 'character'],
    group: 'Catalog',
    useAsTitle: 'sourceRecordKey',
  },
  fields: [
    stableIdField(),
    immutableTextField('sourceRecordKey', { maxLength: 255 }),
    {
      name: 'sourceFamily',
      type: 'text',
      admin: { readOnly: true },
      index: true,
      required: true,
    },
    {
      name: 'sourceUrl',
      type: 'text',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'observedTitle',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'observedManufacturer',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'sourceLabel',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'sourceRole',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'character',
      type: 'relationship',
      admin: { readOnly: true },
      index: true,
      relationTo: catalogRelationTo('characters'),
      required: true,
    },
    {
      name: 'catalogItem',
      type: 'relationship',
      admin: { readOnly: true },
      index: true,
      relationTo: catalogRelationTo('catalog-items'),
      required: true,
    },
    sha256HexField('businessDigest'),
    {
      name: 'businessDigestVersion',
      type: 'number',
      admin: { readOnly: true },
      min: 1,
      required: true,
    },
    lockVersionField(),
    ...attributionFields(),
    ...softDeleteFields(),
  ],
})
