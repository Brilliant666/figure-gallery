import { postgresAdapter } from '@payloadcms/db-postgres'
import path from 'node:path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { buildTechnicalMediaCollection } from './collections/Media'
import { GRAPHQL_POLICY } from './config/payload-policy'
import { loadRuntimeEnvironment } from './config/runtime-environment'
import { createStoragePlugins } from './storage/plugin'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const environment = loadRuntimeEnvironment()
const localMediaRoot = environment.mediaLocalRoot ?? path.resolve(dirname, '../.runtime/media')

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, buildTechnicalMediaCollection(localMediaRoot)],
  graphQL: GRAPHQL_POLICY,
  secret: environment.payloadSecret,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    disableCreateDatabase: true,
    migrationDir: path.resolve(dirname, 'migrations'),
    pool: {
      connectionString: environment.databaseUri,
      connectionTimeoutMillis: 2_000,
      query_timeout: 2_000,
      statement_timeout: 2_000,
    },
    push: false,
  }),
  sharp,
  plugins: createStoragePlugins(environment),
})
