import {
  FIGURE_RELEASE_STATUSES,
  FIGURE_VERSION_KINDS,
  GRAY_MODEL_COMPLETENESS,
} from '@figure-gallery/domain-contracts'
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

export const FigureVersion: CollectionConfig = catalogCollection({
  slug: 'figure-versions',
  dbName: 'figure_versions',
  admin: {
    defaultColumns: ['name', 'prototype', 'kind', 'releaseStatus', 'grayModelCompleteness'],
    group: 'Catalog',
    useAsTitle: 'name',
  },
  fields: [
    stableIdField(),
    {
      name: 'prototype',
      type: 'relationship',
      admin: { readOnly: true },
      index: true,
      relationTo: catalogRelationTo('figure-prototypes'),
      required: true,
    },
    {
      name: 'name',
      type: 'text',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'normalizedVersionKey',
      type: 'text',
      admin: { readOnly: true },
      index: true,
      required: true,
    },
    {
      name: 'kind',
      type: 'select',
      admin: { readOnly: true },
      enumName: 'enum_figure_versions_kind',
      options: selectOptions(FIGURE_VERSION_KINDS),
      required: true,
    },
    {
      name: 'channelOrDistributorLabel',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'releaseStatus',
      type: 'select',
      admin: { readOnly: true },
      defaultValue: 'unknown',
      enumName: 'enum_figure_versions_release_status',
      options: selectOptions(FIGURE_RELEASE_STATUSES),
      required: true,
    },
    {
      name: 'grayModelCompleteness',
      type: 'select',
      admin: { readOnly: true },
      defaultValue: 'not_applicable',
      enumName: 'enum_figure_versions_gray_model_completeness',
      options: selectOptions(GRAY_MODEL_COMPLETENESS),
      required: true,
    },
    {
      name: 'releaseDate',
      type: 'date',
      admin: {
        date: { pickerAppearance: 'dayOnly' },
        readOnly: true,
      },
    },
    {
      name: 'skuOrCode',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { readOnly: true },
    },
    lockVersionField(),
    ...attributionFields(),
    ...softDeleteFields(),
  ],
})
