export interface AppliedMigration {
  batch: number
  name: string
}

export interface MigrationAssessment {
  code:
    | 'current'
    | 'duplicate_migration'
    | 'invalid_migration_batch'
    | 'manifest_empty'
    | 'migration_mismatch'
  current: boolean
}

export function assessMigrationState(
  expectedNames: readonly string[],
  applied: readonly AppliedMigration[],
): MigrationAssessment {
  if (expectedNames.length === 0) return { code: 'manifest_empty', current: false }
  if (new Set(expectedNames).size !== expectedNames.length) {
    return { code: 'duplicate_migration', current: false }
  }
  if (applied.some(({ batch }) => batch <= 0)) {
    return { code: 'invalid_migration_batch', current: false }
  }
  if (new Set(applied.map(({ name }) => name)).size !== applied.length) {
    return { code: 'duplicate_migration', current: false }
  }

  const expected = [...expectedNames].sort()
  const actual = applied.map(({ name }) => name).sort()
  const current =
    expected.length === actual.length && expected.every((name, index) => name === actual[index])
  return current
    ? { code: 'current', current: true }
    : { code: 'migration_mismatch', current: false }
}
