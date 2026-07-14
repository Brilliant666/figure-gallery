import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { CandidateRecords } from '@/collections/CandidateRecords'
import { FigurePrototypes } from '@/collections/FigurePrototypes'
import { Media } from '@/collections/Media'
import { assertPostgresMigrationsReady } from '@/databaseRuntime'

describe('Payload-native configuration', () => {
  it('uses drafts/trash, relationships and upload image sizes', () => {
    expect(FigurePrototypes.versions).toMatchObject({ drafts: true })
    expect(FigurePrototypes.trash).toBe(true)
    expect(
      FigurePrototypes.fields.some(
        (field) => 'name' in field && field.name === 'characters' && field.type === 'relationship',
      ),
    ).toBe(true)
    expect(typeof Media.upload === 'object' ? Media.upload : {}).toMatchObject({
      filesRequiredOnCreate: false,
    })
    expect(
      typeof Media.upload === 'object' && 'imageSizes' in Media.upload ? Media.upload.imageSizes : [],
    ).toHaveLength(2)
    expect(
      Array.isArray(CandidateRecords.endpoints)
        ? CandidateRecords.endpoints.map((endpoint) => endpoint.path)
        : [],
    ).toEqual([
      '/upsert',
      '/upload-media',
      '/review-action',
    ])
  })

  it('keeps the candidate review custom view server-guarded', async () => {
    const view = await readFile(
      path.resolve('src/components/admin/CandidateReviewView.tsx'),
      'utf8',
    )
    expect(view).toContain('if (!isAdminUser(req.user))')
    expect(view).toContain('Administrator access is required.')
    expect(view).not.toContain('src={image.sourceUrl}')
  })

  it('exposes all required audited domain commands in the administrator UI', async () => {
    const [view, client, config] = await Promise.all([
      readFile(path.resolve('src/components/admin/DomainOperationsView.tsx'), 'utf8'),
      readFile(path.resolve('src/components/admin/DomainOperationsClient.tsx'), 'utf8'),
      readFile(path.resolve('src/payload.config.ts'), 'utf8'),
    ])
    for (const label of [
      'Work',
      'Character / aliases',
      'Manufacturer status',
      'FigurePrototype',
      'FigureVersion',
      'Source invalidation',
      'CandidateRecord',
      'CandidateImage',
      'SystemSetting',
      'ReviewWorkItem',
      'OperationLog',
      'merge / split / specified undo',
      'hide / restore / manual main image',
    ]) {
      expect(view).toContain(`'${label}'`)
    }
    for (const action of [
      'maintain-record',
      'open-review',
      'reopen-review',
      'complete-review',
      'revoke-client',
      'merge',
      'split',
      'undo-operation',
      'update-settings',
    ]) {
      expect(client).toContain(`'${action}'`)
    }
    expect(config).toContain("path: '/domain-operations'")
    expect(view).toContain('/api/operation-logs/domain-action')
  })

  it('configures runtime-selected databases and optional official S3 storage fail-closed', async () => {
    const [config, uploadEndpoint] = await Promise.all([
      readFile(path.resolve('src/payload.config.ts'), 'utf8'),
      readFile(path.resolve('src/endpoints/candidateMediaUpload.ts'), 'utf8'),
    ])
    const packageDocument = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(config).toContain("transactionOptions: { behavior: 'immediate' }")
    expect(config).toContain('postgresAdapter({')
    expect(config).toContain('prodMigrations: postgresMigrations')
    expect(packageDocument.dependencies['@payloadcms/db-postgres']).toBe('3.86.0')
    expect(config).toContain('s3Storage({')
    expect(config).toContain("if (process.env.S3_ENABLED !== 'true') return []")
    expect(config).toContain("required('S3_ACCESS_KEY_ID')")
    expect(config).toContain("prefix: required('S3_PREFIX')")
    expect(config).toContain('useCompositePrefixes: true')
    expect(config).toContain('guardedS3Endpoint(process.env.S3_ENDPOINT)')
    expect(uploadEndpoint).toContain("process.env.S3_ENABLED === 'true' ? { prefix: objectPrefix } : {}")
    expect(config).toContain("avatar: 'default'")
    expect(config).toContain('telemetry: false')
    expect(packageDocument.scripts.dev).toContain('-H 127.0.0.1')
    expect(packageDocument.scripts.start).toBe('node .next/standalone/server.js')

    expect(() =>
      assertPostgresMigrationsReady({
        allowEmptyForGeneration: false,
        argv: ['payload', 'migrate:create'],
        migrationCount: 0,
      }),
    ).toThrow(/PostgreSQL migrations are empty/)
    expect(() =>
      assertPostgresMigrationsReady({
        allowEmptyForGeneration: true,
        argv: ['payload', 'migrate'],
        migrationCount: 0,
      }),
    ).toThrow(/PostgreSQL migrations are empty/)
    expect(() =>
      assertPostgresMigrationsReady({
        allowEmptyForGeneration: true,
        argv: ['payload', 'migrate:create'],
        migrationCount: 0,
      }),
    ).not.toThrow()
    expect(() =>
      assertPostgresMigrationsReady({
        allowEmptyForGeneration: false,
        argv: ['payload', 'migrate'],
        migrationCount: 1,
      }),
    ).not.toThrow()
  })
})
