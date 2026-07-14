export type PostgresMigrationGateOptions = {
  allowEmptyForGeneration: boolean
  argv: readonly string[]
  migrationCount: number
}

export const assertPostgresMigrationsReady = ({
  allowEmptyForGeneration,
  argv,
  migrationCount,
}: PostgresMigrationGateOptions): void => {
  if (migrationCount > 0) return

  const isMigrationGeneration = argv.includes('migrate:create')
  if (allowEmptyForGeneration && isMigrationGeneration) return

  throw new Error(
    'PostgreSQL migrations are empty. Generate them with migrate:create and the explicit generation-only gate; ordinary migrate and application startup remain blocked.',
  )
}
