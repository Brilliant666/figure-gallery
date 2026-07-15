import path from 'node:path'
import type { Access, CollectionConfig } from 'payload'

const authenticated: Access = ({ req }) => Boolean(req.user)

export function buildTechnicalMediaCollection(localRoot: string): CollectionConfig {
  return {
    slug: 'media',
    admin: {
      description: 'Private infrastructure media used only to validate the storage boundary.',
    },
    access: {
      create: authenticated,
      delete: authenticated,
      read: authenticated,
      update: authenticated,
    },
    fields: [],
    upload: {
      staticDir: path.resolve(localRoot),
    },
  }
}
