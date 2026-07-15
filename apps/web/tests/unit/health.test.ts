import { describe, expect, it, vi } from 'vitest'

import { buildLiveHealth } from '../../src/health/live'
import { evaluateReadiness, ReadinessDependencyError } from '../../src/health/readiness'

const source = {
  BUILD_VERSION: 'test-build',
  DATABASE_URI: 'postgresql://figure-gallery@127.0.0.1:5432/figure_gallery',
  MEDIA_LOCAL_ROOT: '.runtime/media',
  MEDIA_STORAGE_DRIVER: 'filesystem',
  NODE_ENV: 'test',
  PAYLOAD_SECRET: 'synthetic-test-secret-with-sufficient-length',
}

describe('health contracts', () => {
  it('keeps liveness independent from runtime configuration and dependencies', () => {
    expect(buildLiveHealth({})).toEqual({
      buildVersion: 'unknown',
      checks: { process: { status: 'pass' } },
      status: 'ok',
    })
    expect(buildLiveHealth({ BUILD_VERSION: 'test-build' }).buildVersion).toBe('test-build')
  })

  it('reports ready only when database and migrations pass', async () => {
    const database = vi.fn(async () => undefined)
    const migrations = vi.fn(async () => undefined)
    const result = await evaluateReadiness({
      createDependencies: () => ({ database, migrations }),
      source,
    })
    expect(result).toMatchObject({ body: { status: 'ok' }, status: 200 })
    expect(database).toHaveBeenCalledOnce()
    expect(migrations).toHaveBeenCalledOnce()
  })

  it('returns a sanitized 503 and skips migrations when PostgreSQL fails', async () => {
    const marker = 'database-secret-detail'
    const migrations = vi.fn(async () => undefined)
    const result = await evaluateReadiness({
      createDependencies: () => ({
        database: async () => {
          throw new Error(marker)
        },
        migrations,
      }),
      source,
    })
    expect(result.status).toBe(503)
    expect(result.body.checks.database).toEqual({ code: 'unavailable', status: 'fail' })
    expect(result.body.checks.migrations).toEqual({ status: 'not_run' })
    expect(JSON.stringify(result)).not.toContain(marker)
  })

  it('returns a classified 503 for migration drift', async () => {
    const result = await evaluateReadiness({
      createDependencies: () => ({
        database: async () => undefined,
        migrations: async () => {
          throw new ReadinessDependencyError('migration_mismatch')
        },
      }),
      source,
    })
    expect(result).toMatchObject({
      body: { checks: { migrations: { code: 'migration_mismatch', status: 'fail' } } },
      status: 503,
    })
  })

  it('returns a sanitized 503 when S3 storage is unavailable', async () => {
    const marker = 'storage-secret-detail'
    const result = await evaluateReadiness({
      createDependencies: () => ({
        database: async () => undefined,
        migrations: async () => undefined,
        storage: async () => {
          throw new Error(marker)
        },
      }),
      source: {
        ...source,
        MEDIA_STORAGE_DRIVER: 's3',
        S3_ACCESS_KEY_ID: 'synthetic-access-key',
        S3_BUCKET: 'synthetic-bucket',
        S3_ENDPOINT: 'http://127.0.0.1:9000',
        S3_FORCE_PATH_STYLE: 'true',
        S3_REGION: 'us-east-1',
        S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
      },
    })
    expect(result.body.checks.storage).toEqual({ code: 'unavailable', status: 'fail' })
    expect(result.status).toBe(503)
    expect(JSON.stringify(result)).not.toContain(marker)
  })

  it('bounds dependency checks', async () => {
    const result = await evaluateReadiness({
      createDependencies: () => ({
        database: () => new Promise<void>(() => undefined),
        migrations: async () => undefined,
      }),
      source,
      timeoutMs: 5,
    })
    expect(result.body.checks.database).toEqual({ code: 'timeout', status: 'fail' })
    expect(result.status).toBe(503)
  })

  it('fails closed on invalid environment input without constructing dependencies', async () => {
    const createDependencies = vi.fn()
    const result = await evaluateReadiness({ createDependencies, source: {} })
    expect(result).toMatchObject({
      body: { checks: { configuration: { code: 'invalid_environment', status: 'fail' } } },
      status: 503,
    })
    expect(createDependencies).not.toHaveBeenCalled()
  })
})
