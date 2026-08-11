import type { CollectionConfig } from 'payload'

import {
  attributionFields,
  catalogCollection,
  catalogRelationTo,
  immutableTextField,
  lockVersionField,
  softDeleteFields,
  stableIdField,
} from './common'

export const CatalogItem: CollectionConfig = catalogCollection({
  slug: 'catalog-items',
  dbName: 'catalog_items',
  admin: {
    defaultColumns: ['title', 'character', 'prototype', 'manufacturerText', 'classification'],
    group: 'Catalog',
    useAsTitle: 'title',
  },
  fields: [
    stableIdField(),
    immutableTextField('catalogItemKey', { maxLength: 255 }),
    {
      name: 'character',
      type: 'relationship',
      admin: { readOnly: true },
      index: true,
      relationTo: catalogRelationTo('characters'),
      required: true,
    },
    {
      name: 'prototype',
      type: 'relationship',
      admin: { readOnly: true },
      index: true,
      relationTo: catalogRelationTo('figure-prototypes'),
      required: true,
    },
    {
      name: 'title',
      type: 'text',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'manufacturerText',
      type: 'text',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'classification',
      type: 'text',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'category',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'scale',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'heightMm',
      type: 'number',
      admin: { readOnly: true },
      min: 0,
    },
    {
      name: 'release',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'productType',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'series',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: { readOnly: true },
    },
    {
      name: 'imageRefs',
      type: 'array',
      admin: { readOnly: true },
      fields: [
        {
          name: 'imageRefKey',
          type: 'text',
          admin: { readOnly: true },
          required: true,
        },
        {
          name: 'url',
          type: 'text',
          admin: { readOnly: true },
          required: true,
        },
        {
          name: 'sourceFamily',
          type: 'text',
          admin: { readOnly: true },
          required: true,
        },
        {
          name: 'catalogItemKey',
          type: 'text',
          admin: { readOnly: true },
          required: true,
        },
        {
          name: 'isMain',
          type: 'checkbox',
          admin: { readOnly: true },
          defaultValue: false,
          required: true,
        },
      ],
    },
    lockVersionField(),
    ...attributionFields(),
    ...softDeleteFields(),
  ],
})
