import type { RuntimeEnvironment } from '../config/environment'

export interface S3ClientBoundary {
  credentials: {
    accessKeyId: string
    secretAccessKey: string
  }
  endpoint: string
  forcePathStyle: boolean
  region: string
}

export function toS3ClientBoundary(environment: RuntimeEnvironment): S3ClientBoundary {
  if (environment.mediaStorageDriver !== 's3' || !environment.s3) {
    throw new Error('S3 storage is not configured')
  }

  return {
    credentials: {
      accessKeyId: environment.s3.accessKeyId,
      secretAccessKey: environment.s3.secretAccessKey,
    },
    endpoint: environment.s3.endpoint,
    forcePathStyle: environment.s3.forcePathStyle,
    region: environment.s3.region,
  }
}
