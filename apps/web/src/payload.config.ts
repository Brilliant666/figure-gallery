import { postgresAdapter } from '@payloadcms/db-postgres'
import path from 'node:path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { buildTechnicalMediaCollection } from './collections/Media'
import { CatalogCollections } from './collections/CatalogCollections'
import { GRAPHQL_POLICY } from './config/payload-policy'
import { applyCatalogForeignKeyPolicy } from './db/catalog-foreign-key-policy'
import { loadRuntimeEnvironment } from './config/runtime-environment'
import { CatalogCommandEndpoint } from './domain/catalog'
import { createStoragePlugins } from './storage/plugin'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const environment = loadRuntimeEnvironment()
const localMediaRoot = environment.mediaLocalRoot ?? path.resolve(dirname, '../.runtime/media')

export default buildConfig({
  admin: {
    user: Users.slug,
    components: {
      beforeNavLinks: ['/admin/catalog/CatalogOperationsNavLink#CatalogOperationsNavLink'],
      views: {
        catalogOperations: {
          Component: '/admin/catalog/CatalogOperationsView#CatalogOperationsView',
          exact: true,
          path: '/catalog-operations',
        },
      },
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, buildTechnicalMediaCollection(localMediaRoot), ...CatalogCollections],
  endpoints: [CatalogCommandEndpoint],
  graphQL: GRAPHQL_POLICY,
  secret: environment.payloadSecret,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    beforeSchemaInit: [applyCatalogForeignKeyPolicy],
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
