import type { CollectionConfig } from 'payload'

import { protectMainImage } from '@/hooks/protectMainImage'
import { adminFieldOnly, publicReadOrAdmin } from '@/security/roles'

export const FigurePrototypes: CollectionConfig = {
  slug: 'figure-prototypes',
  admin: {
    defaultColumns: ['title', 'manufacturer', 'figureType', 'publicationStatus'],
    useAsTitle: 'title',
  },
  access: {
    create: () => false,
    delete: () => false,
    read: publicReadOrAdmin,
    update: () => false,
  },
  hooks: { beforeChange: [protectMainImage] },
  trash: true,
  versions: { drafts: true, maxPerDoc: 50 },
  fields: [
    { name: 'fixtureID', type: 'text', index: true, unique: true },
    { name: 'title', type: 'text', required: true },
    {
      name: 'characters',
      type: 'relationship',
      hasMany: true,
      minRows: 1,
      relationTo: 'characters',
      required: true,
    },
    { name: 'work', type: 'relationship', relationTo: 'works' },
    { name: 'manufacturer', type: 'relationship', relationTo: 'manufacturers', required: true },
    {
      name: 'figureType',
      type: 'select',
      options: [
        { label: 'Scale figure', value: 'scale' },
        { label: 'Prize figure', value: 'prize' },
      ],
      required: true,
    },
    { name: 'scale', type: 'text' },
    { name: 'costumeText', type: 'textarea' },
    { name: 'isGroup', type: 'checkbox', defaultValue: false, required: true },
    { name: 'isAdult', type: 'checkbox', defaultValue: false, required: true },
    {
      name: 'publicationStatus',
      type: 'select',
      defaultValue: 'draft',
      options: ['draft', 'published', 'hidden', 'merged'],
      required: true,
    },
    { name: 'softDeleted', type: 'checkbox', defaultValue: false, required: true },
    { name: 'lockVersion', type: 'number', defaultValue: 1, min: 1, required: true },
    {
      name: 'mainImage',
      type: 'relationship',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      admin: {
        description: 'Read-only here; use Candidate review workbench so the change is audited.',
        readOnly: true,
      },
      relationTo: 'media',
    },
    { name: 'mergedInto', type: 'relationship', relationTo: 'figure-prototypes' },
  ],
}
