import { PROTOTYPE_CHARACTER_ROLES } from '@figure-gallery/domain-contracts'
import type { CollectionConfig } from 'payload'

import {
  actorField,
  catalogCollection,
  catalogRelationTo,
  selectOptions,
  softDeleteFields,
  stableIdField,
} from './common'

export const FigurePrototypeCharacter: CollectionConfig = catalogCollection({
  slug: 'figure-prototype-characters',
  dbName: 'figure_prototype_characters',
  admin: {
    defaultColumns: ['prototype', 'character', 'displayOrder', 'role'],
    group: 'Catalog',
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
      name: 'character',
      type: 'relationship',
      admin: { readOnly: true },
      index: true,
      relationTo: catalogRelationTo('characters'),
      required: true,
    },
    {
      name: 'displayOrder',
      type: 'number',
      admin: { readOnly: true },
      min: 0,
      required: true,
    },
    {
      name: 'role',
      type: 'select',
      admin: { readOnly: true },
      enumName: 'enum_figure_prototype_characters_role',
      options: selectOptions(PROTOTYPE_CHARACTER_ROLES),
      required: true,
    },
    actorField('createdBy'),
    ...softDeleteFields(),
  ],
})
