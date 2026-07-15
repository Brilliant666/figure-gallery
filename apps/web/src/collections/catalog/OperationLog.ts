import { OPERATION_ACTOR_TYPES, OPERATION_DUTY_CONTEXTS } from '@figure-gallery/domain-contracts'
import type { CollectionConfig } from 'payload'

import { actorField, catalogCollection, immutableUuidField, selectOptions } from './common'

export const OperationLog: CollectionConfig = catalogCollection({
  slug: 'operation-logs',
  dbName: 'operation_logs',
  admin: {
    defaultColumns: ['operationId', 'action', 'scopeType', 'actorType', 'createdAt'],
    group: 'Operations',
    useAsTitle: 'operationId',
  },
  fields: [
    immutableUuidField('operationId'),
    actorField('actorUser', false),
    {
      name: 'actorType',
      type: 'select',
      admin: { readOnly: true },
      enumName: 'enum_operation_logs_actor_type',
      options: selectOptions(OPERATION_ACTOR_TYPES),
      required: true,
    },
    {
      name: 'dutyContext',
      type: 'select',
      admin: { readOnly: true },
      enumName: 'enum_operation_logs_duty_context',
      options: selectOptions(OPERATION_DUTY_CONTEXTS),
      required: true,
    },
    {
      name: 'action',
      type: 'text',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'scopeType',
      type: 'text',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'scopeStableId',
      type: 'text',
      admin: { readOnly: true },
      index: true,
      maxLength: 36,
      minLength: 36,
      required: true,
    },
    {
      name: 'reason',
      type: 'textarea',
      admin: { readOnly: true },
      required: true,
    },
    {
      name: 'expectedVersion',
      type: 'number',
      admin: { readOnly: true },
      min: 1,
    },
    {
      name: 'resultVersion',
      type: 'number',
      admin: { readOnly: true },
      min: 1,
      required: true,
    },
    {
      name: 'beforeSnapshot',
      type: 'json',
      admin: { readOnly: true },
    },
    {
      name: 'afterSnapshot',
      type: 'json',
      admin: { readOnly: true },
    },
    {
      name: 'requestDigest',
      type: 'text',
      admin: { readOnly: true },
      maxLength: 64,
      minLength: 64,
      required: true,
    },
    {
      name: 'reversible',
      type: 'checkbox',
      admin: { readOnly: true },
      defaultValue: false,
      required: true,
      validate: (value) => value === false || 'PR-01 operations are not reversible.',
    },
  ],
})
