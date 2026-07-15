import { describe, expect, it } from 'vitest'

import { parseEnvironment } from '../../src/config/environment'
import { toS3ClientBoundary } from '../../src/storage/config'

describe('S3 configuration boundary', () => {
  it('keeps endpoint and credentials in the server-only adapter configuration', () => {
    const environment = parseEnvironment({
      BUILD_VERSION: 'test-build',
      DATABASE_URI: 'postgresql://figure-gallery@127.0.0.1:5432/figure_gallery',
      MEDIA_STORAGE_DRIVER: 's3',
      NODE_ENV: 'test',
      PAYLOAD_SECRET: 'synthetic-test-secret-with-sufficient-length',
      S3_ACCESS_KEY_ID: 'synthetic-access-key',
      S3_BUCKET: 'synthetic-bucket',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      S3_FORCE_PATH_STYLE: 'true',
      S3_REGION: 'us-east-1',
      S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
    })

    expect(toS3ClientBoundary(environment)).toEqual({
      credentials: {
        accessKeyId: 'synthetic-access-key',
        secretAccessKey: 'synthetic-secret-key',
      },
      endpoint: 'http://127.0.0.1:9000',
      forcePathStyle: true,
      region: 'us-east-1',
    })
  })

  it('rejects use when the selected driver is filesystem', () => {
    const environment = parseEnvironment({
      BUILD_VERSION: 'test-build',
      DATABASE_URI: 'postgresql://figure-gallery@127.0.0.1:5432/figure_gallery',
      MEDIA_LOCAL_ROOT: '.runtime/media',
      MEDIA_STORAGE_DRIVER: 'filesystem',
      NODE_ENV: 'test',
      PAYLOAD_SECRET: 'synthetic-test-secret-with-sufficient-length',
    })
    expect(() => toS3ClientBoundary(environment)).toThrow('S3 storage is not configured')
  })
})
