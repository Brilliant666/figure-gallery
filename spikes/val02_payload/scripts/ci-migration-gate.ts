import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getPayload, type Migration } from 'payload'

type GateMode = 'fresh' | 'repeat'
type QueryResult<Row extends Record<string, unknown>> = { rows: Row[] }
type PostgresPool = {
  query: <Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ) => Promise<QueryResult<Row>>
}
type MigrationRow = { batch: number; name: string }
type MigrationState = { migration_table_exists: boolean; migrations: MigrationRow[] }

const option = (name: string): string => {
  const prefix = `--${name}=`
  const matches = process.argv.filter((arg) => arg.startsWith(prefix))
  if (matches.length !== 1) throw new Error(`${prefix}<value> is required exactly once.`)
  const value = matches[0].slice(prefix.length).trim()
  if (!value) throw new Error(`${prefix}<value> cannot be empty.`)
  return value
}

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

const isBelow = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

if (process.env.PAYLOAD_CI_PRODUCTION_GATE !== 'true') {
  throw new Error('ci-migration-gate is restricted to the explicit production-gate runner.')
}
if (process.env.DATABASE_ADAPTER !== 'postgres') {
  throw new Error('ci-migration-gate requires the PostgreSQL adapter.')
}
if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'ci-migration-gate requires NODE_ENV to remain non-production so adapter connect cannot auto-run prodMigrations before the pre-migration snapshot.',
  )
}

const modeArg = option('mode')
if (modeArg !== 'fresh' && modeArg !== 'repeat') {
  throw new Error('--mode must be fresh or repeat.')
}
const mode: GateMode = modeArg
const runnerTemp = path.resolve(requiredEnvironment('RUNNER_TEMP'))
const output = path.resolve(option('out'))
if (!isBelow(runnerTemp, output)) {
  throw new Error('ci-migration-gate output must remain below RUNNER_TEMP.')
}

// Payload's CLI sets this before loading the configuration. Do the same here so
// importing the config cannot enter development push mode before the explicit
// production migrations are supplied to the adapter.
process.env.PAYLOAD_MIGRATING = 'true'
process.env.DISABLE_PAYLOAD_HMR = 'true'

const [{ default: config }, { migrations: postgresMigrations }] = await Promise.all([
  import('@payload-config'),
  import('@/migrations-postgres'),
])

const migrationNamePattern = /^\d{8}_\d{6}_[a-z0-9_]+$/
const configuredNames = postgresMigrations.map((migration) => {
  const name = migration.name
  if (typeof name !== 'string' || !migrationNamePattern.test(name)) {
    throw new Error('Every configured PostgreSQL migration must have a sanitized migration name.')
  }
  return name
})
if (!configuredNames.length) throw new Error('At least one explicit PostgreSQL migration is required.')
if (new Set(configuredNames).size !== configuredNames.length) {
  throw new Error('Configured PostgreSQL migration names must be unique.')
}
const expectedNames = [...configuredNames].sort()
const configuredNameSet = new Set(expectedNames)

const readState = async (pool: PostgresPool): Promise<MigrationState> => {
  const existence = await pool.query<{ exists: unknown }>(
    "select to_regclass('public.payload_migrations') is not null as exists",
  )
  if (existence.rows.length !== 1 || typeof existence.rows[0].exists !== 'boolean') {
    throw new Error('Could not determine whether the PostgreSQL migration table exists.')
  }
  const migrationTableExists = existence.rows[0].exists
  if (!migrationTableExists) {
    return { migration_table_exists: false, migrations: [] }
  }

  const result = await pool.query<{ batch: unknown; name: unknown }>(
    'select name, batch from payload_migrations order by name, id',
  )
  const seen = new Set<string>()
  const rows = result.rows.map((row) => {
    if (typeof row.name !== 'string' || !configuredNameSet.has(row.name)) {
      throw new Error('The PostgreSQL migration table contains an unknown or unsanitized migration name.')
    }
    if (seen.has(row.name)) {
      throw new Error('The PostgreSQL migration table contains a duplicate migration name.')
    }
    seen.add(row.name)
    const batch = Number(row.batch)
    if (batch === -1) {
      throw new Error('A development-mode batch=-1 migration record is not permitted.')
    }
    if (!Number.isSafeInteger(batch) || batch <= 0) {
      throw new Error('Every PostgreSQL migration batch must be a positive integer.')
    }
    return { batch, name: row.name }
  })
  return { migration_table_exists: true, migrations: rows }
}

const namesOf = (state: MigrationState): string[] => state.migrations.map(({ name }) => name).sort()
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

type PayloadInstance = Awaited<ReturnType<typeof getPayload>>
let payload: PayloadInstance | undefined
let pool: PostgresPool | undefined
let result:
  | {
      added_migrations: string[]
      after: MigrationState
      before: MigrationState
      configured_migrations: string[]
      migration_engine: 'payload.db.migrate'
      mode: GateMode
      schema_version: 1
      status: 'pass'
    }
  | undefined
let operationError: unknown

try {
  payload = await getPayload({ config, disableOnInit: true })
  pool = (payload.db as unknown as { pool?: PostgresPool }).pool
  if (!pool?.query) {
    throw new Error('The active adapter did not expose a PostgreSQL pool.')
  }

  const before = await readState(pool)
  if (mode === 'fresh') {
    if (before.migration_table_exists || before.migrations.length) {
      throw new Error('fresh mode requires a database without a migration table or migration rows.')
    }
  } else if (!before.migration_table_exists || !equal(namesOf(before), expectedNames)) {
    throw new Error('repeat mode requires exactly the configured migrations to exist before execution.')
  }

  await payload.db.migrate({ migrations: postgresMigrations as unknown as Migration[] })

  const after = await readState(pool)
  if (!after.migration_table_exists) {
    throw new Error('The migration table does not exist after the real migration engine completed.')
  }

  if (mode === 'fresh') {
    if (!equal(namesOf(after), expectedNames)) {
      throw new Error('fresh mode did not add exactly the configured PostgreSQL migrations.')
    }
  } else if (!equal(after, before)) {
    throw new Error('repeat mode changed the migration table instead of remaining idempotent.')
  }

  const beforeNames = new Set(namesOf(before))
  const addedMigrations = namesOf(after).filter((name) => !beforeNames.has(name))
  if (mode === 'fresh' && !equal(addedMigrations, expectedNames)) {
    throw new Error('fresh mode migration delta does not match the configured migrations.')
  }
  if (mode === 'repeat' && addedMigrations.length) {
    throw new Error('repeat mode added a migration record.')
  }

  result = {
    added_migrations: addedMigrations,
    after,
    before,
    configured_migrations: expectedNames,
    migration_engine: 'payload.db.migrate',
    mode,
    schema_version: 1,
    status: 'pass',
  }
} catch (error) {
  operationError = error
}

let payloadDestroyFailed = false
if (payload) {
  try {
    await payload.destroy()
  } catch {
    payloadDestroyFailed = true
  }
}

if (operationError) throw operationError
if (payloadDestroyFailed) {
  throw new Error('PostgreSQL migration gate Payload cleanup did not complete successfully.')
}
if (!result) throw new Error('PostgreSQL migration gate did not produce a result.')

await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ output, status: 'migration-gate-passed' }))
// Payload 3.86's PostgreSQL adapter intentionally keeps a listener client and
// its CLI terminates explicitly after one-shot commands. Do the same only
// after the sanitized evidence is durable; waiting on pg Pool.end() would
// deadlock on that adapter-owned client.
process.exit(0)
