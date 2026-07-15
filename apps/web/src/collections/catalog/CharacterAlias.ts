import { CHARACTER_ALIAS_TYPES } from '@figure-gallery/domain-contracts'
import type { CollectionConfig } from 'payload'

import {
  actorField,
  catalogCollection,
  catalogRelationTo,
  selectOptions,
  softDeleteFields,
  stableIdField,
} from './common'

export const CharacterAlias: CollectionConfig = catalogCollection({
  slug: 'character-aliases',
  dbName: 'character_aliases',
  admin: {
    defaultColumns: ['value', 'character', 'locale', 'aliasType', 'isPreferred'],
    group: 'Catalog',
    useAsTitle: 'value',
  },
  fields: [
    stableIdField(),
    {
      name: 'character',
      type: 'relationship',
      admin: { readOnly: true },
      index: true,
      relationTo: catalogRelationTo('characters'),
      required: true,
    },
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
      index: true,
      required: true,
    },
    {
      name: 'locale',
      type: 'text',
      admin: { readOnly: true },
      maxLength: 35,
    },
    {
      name: 'aliasType',
      type: 'select',
      admin: { readOnly: true },
      defaultValue: 'common',
      enumName: 'enum_character_aliases_alias_type',
      options: selectOptions(CHARACTER_ALIAS_TYPES),
      required: true,
    },
    {
      name: 'isPreferred',
      type: 'checkbox',
      admin: { readOnly: true },
      defaultValue: false,
      required: true,
    },
    actorField('createdBy'),
    ...softDeleteFields(),
  ],
})
