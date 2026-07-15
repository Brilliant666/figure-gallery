import { s3Storage } from '@payloadcms/storage-s3'
import type { Plugin } from 'payload'

import { assertServerOnly } from '../config/assert-server-only'
import type { RuntimeEnvironment } from '../config/environment'
import { toS3ClientBoundary } from './config'

assertServerOnly()

export function createStoragePlugins(environment: RuntimeEnvironment): Plugin[] {
  if (environment.mediaStorageDriver !== 's3' || !environment.s3) return []

  return [
    s3Storage({
      bucket: environment.s3.bucket,
      collections: {
        media: true,
      },
      config: toS3ClientBoundary(environment),
    }),
  ]
}
