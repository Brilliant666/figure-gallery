import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { getMigrations, getPayload } from 'payload'

import { assertServerOnly } from '../config/assert-server-only'
import type { RuntimeEnvironment } from '../config/environment'
import { migrations } from '../migrations'
import { toS3ClientBoundary } from '../storage/config'
import { assessMigrationState, type AppliedMigration } from './migrations'
import {
  evaluateReadiness,
  ReadinessDependencyError,
  type ReadinessDependencies,
} from './readiness'

assertServerOnly()

const FORMAL_MIGRATION_NAMES = migrations.map(({ name }) => name)

async function createRuntimeDependencies(
  environment: RuntimeEnvironment,
): Promise<ReadinessDependencies> {
  const { default: payloadConfig } = await import('../payload.config')
  const payloadPromise = getPayload({ config: payloadConfig })

  return {
    database: async () => {
      const payload = await payloadPromise
      await payload.db.pool.query('SELECT 1')
    },
    migrations: async () => {
      const payload = await payloadPromise
      const [{ existingMigrations }, invalidBatchResult] = await Promise.all([
        getMigrations({ payload }),
        payload.db.pool.query<AppliedMigration>(
          'SELECT name, batch FROM payload_migrations WHERE batch <= 0 ORDER BY name ASC',
        ),
      ])
      const applied: AppliedMigration[] = existingMigrations.map(({ batch, name }) => ({
        batch: Number(batch),
        name,
      }))
      applied.push(...invalidBatchResult.rows)
      const assessment = assessMigrationState(FORMAL_MIGRATION_NAMES, applied)
      if (!assessment.current) throw new ReadinessDependencyError(assessment.code)
    },
    storage:
      environment.mediaStorageDriver === 's3' && environment.s3
        ? async (signal) => {
            const client = new S3Client(toS3ClientBoundary(environment))
            try {
              await client.send(new HeadBucketCommand({ Bucket: environment.s3?.bucket }), {
                abortSignal: signal,
              })
            } finally {
              client.destroy()
            }
          }
        : undefined,
  }
}

export async function runRuntimeReadiness() {
  return evaluateReadiness({
    createDependencies: createRuntimeDependencies,
    source: process.env,
  })
}
