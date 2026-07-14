import path from 'node:path'
import type { CollectionConfig, Where } from 'payload'

import {
  adminFieldOnly,
  isAdminUser,
  isPublicReadEnabled,
} from '@/security/roles'
import { candidateMediaBoundary } from '@/hooks/candidateMediaBoundary'

// The fallback is bounded to one runtime directory. The Turbopack hint keeps
// standalone NFT tracing from treating the entire project as media input.
const defaultMediaDir = path.join(/* turbopackIgnore: true */ process.cwd(), 'media')
const staticDir = process.env.MEDIA_DIR ?? defaultMediaDir

export const Media: CollectionConfig = {
  slug: 'media',
  admin: { useAsTitle: 'filename' },
  access: {
    create: () => false,
    delete: () => false,
    read: async ({ req }) => {
      if (isAdminUser(req.user)) return true
      if (!(await isPublicReadEnabled(req))) return false
      return {
        and: [{ candidateOnly: { equals: false } }, { isAdult: { equals: false } }],
      } as Where
    },
    update: () => false,
  },
  hooks: { beforeChange: [candidateMediaBoundary] },
  trash: true,
  upload: {
    adminThumbnail: 'thumbnail',
    filesRequiredOnCreate: false,
    imageSizes: [
      {
        name: 'thumbnail',
        width: 320,
        withoutEnlargement: true,
      },
      {
        name: 'preview',
        width: 1280,
        withoutEnlargement: true,
      },
    ],
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    staticDir,
  },
  fields: [
    { name: 'fixtureID', type: 'text', index: true, unique: true },
    { name: 'candidateOnly', type: 'checkbox', defaultValue: true, required: true },
    { name: 'candidate', type: 'relationship', relationTo: 'candidate-records' },
    {
      name: 'candidateOwner',
      type: 'relationship',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      relationTo: 'users',
    },
    { name: 'clientCandidateID', type: 'text', index: true },
    { name: 'idempotencyKey', type: 'text', index: true },
    {
      name: 'prototype',
      type: 'relationship',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      relationTo: 'figure-prototypes',
    },
    { name: 'sourceUrl', type: 'text', required: true },
    { name: 'storageKey', type: 'text', index: true, required: true },
    { name: 'byteSize', type: 'number' },
    { name: 'pixelWidth', type: 'number' },
    { name: 'pixelHeight', type: 'number' },
    { name: 'format', type: 'text' },
    { name: 'sha256', type: 'text', index: true, required: true },
    { name: 'perceptualHash', type: 'text' },
    { name: 'isAdult', type: 'checkbox', defaultValue: false, required: true },
    { name: 'isSourceHomepage', type: 'checkbox', defaultValue: false, required: true },
    { name: 'presentInLatestSource', type: 'checkbox', defaultValue: true, required: true },
    {
      name: 'selectedAsMain',
      type: 'checkbox',
      access: { create: adminFieldOnly, update: adminFieldOnly },
      defaultValue: false,
      required: true,
    },
  ],
}
