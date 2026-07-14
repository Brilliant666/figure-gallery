import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig, type Plugin } from 'payload'
import sharp from 'sharp'

import { CandidateRecords } from '@/collections/CandidateRecords'
import { Characters } from '@/collections/Characters'
import { FigurePrototypes } from '@/collections/FigurePrototypes'
import { FigureVersions } from '@/collections/FigureVersions'
import { Manufacturers } from '@/collections/Manufacturers'
import { Media } from '@/collections/Media'
import { OperationLogs } from '@/collections/OperationLogs'
import { ReviewWorkItems } from '@/collections/ReviewWorkItems'
import { SourceRecords } from '@/collections/SourceRecords'
import { Users } from '@/collections/Users'
import { Works } from '@/collections/Works'
import { rootCandidateMediaUploadEndpoint } from '@/endpoints/candidateMediaUpload'
import { SystemSettings } from '@/globals/SystemSettings'
import { migrations as sqliteMigrations } from '@/migrations'
import { migrations as postgresMigrations } from '@/migrations-postgres'
import { guardedS3Endpoint } from '@/security/networkGuard'
import { assertPostgresMigrationsReady } from '@/databaseRuntime'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const required = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} must be supplied at runtime; no secret is committed.`)
  return value
}

const optionalS3Plugin = (): Plugin[] => {
  if (process.env.S3_ENABLED !== 'true') return []

  return [
    s3Storage({
      alwaysInsertFields: true,
      bucket: required('S3_BUCKET'),
      collections: {
        media: {
          prefix: required('S3_PREFIX'),
        },
      },
      config: {
        credentials: {
          accessKeyId: required('S3_ACCESS_KEY_ID'),
          secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
        },
        endpoint: guardedS3Endpoint(process.env.S3_ENDPOINT),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        region: required('S3_REGION'),
      },
      disableLocalStorage: true,
      useCompositePrefixes: true,
    }),
  ]
}

const databaseAdapter = () => {
  const adapter = process.env.DATABASE_ADAPTER?.trim() || 'sqlite'
  const connectionString = required('DATABASE_URI')

  if (adapter === 'sqlite') {
    return sqliteAdapter({
      client: { url: connectionString },
      migrationDir: path.resolve(dirname, 'migrations'),
      prodMigrations: sqliteMigrations,
      transactionOptions: { behavior: 'immediate' },
    })
  }

  if (adapter === 'postgres') {
    assertPostgresMigrationsReady({
      allowEmptyForGeneration:
        process.env.PAYLOAD_ALLOW_EMPTY_POSTGRES_MIGRATIONS_FOR_GENERATION === 'true',
      argv: process.argv,
      migrationCount: postgresMigrations.length,
    })
    return postgresAdapter({
      disableCreateDatabase: true,
      idType: 'serial',
      migrationDir: path.resolve(dirname, 'migrations-postgres'),
      pool: { connectionString },
      prodMigrations: postgresMigrations,
      push: false,
    })
  }

  throw new Error(`Unsupported DATABASE_ADAPTER: ${adapter}`)
}

export default buildConfig({
  endpoints: [rootCandidateMediaUploadEndpoint],
  admin: {
    // Keep the disposable admin fully local during validation. Payload's
    // default Gravatar avatar would otherwise issue a browser request to an
    // unrelated third-party host after login.
    avatar: 'default',
    components: {
      views: {
        candidateReview: {
          Component: '/components/admin/CandidateReviewView#CandidateReviewView',
          path: '/candidate-review',
        },
        domainOperations: {
          Component: '/components/admin/DomainOperationsView#DomainOperationsView',
          path: '/domain-operations',
        },
      },
    },
    importMap: { baseDir: path.resolve(dirname) },
    user: Users.slug,
  },
  collections: [
    Users,
    Works,
    Characters,
    Manufacturers,
    Media,
    FigurePrototypes,
    FigureVersions,
    SourceRecords,
    CandidateRecords,
    ReviewWorkItems,
    OperationLogs,
  ],
  db: databaseAdapter(),
  globals: [SystemSettings],
  plugins: optionalS3Plugin(),
  secret: required('PAYLOAD_SECRET'),
  sharp,
  telemetry: false,
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
})
