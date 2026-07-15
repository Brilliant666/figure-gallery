import { describe, expect, it } from 'vitest'

import { assessMigrationState } from '../../src/health/migrations'

describe('migration readiness', () => {
  it('never treats an empty formal manifest as current', () => {
    expect(assessMigrationState([], [])).toEqual({ code: 'manifest_empty', current: false })
  })

  it('accepts an exact official migration set', () => {
    expect(
      assessMigrationState(['20260715_baseline'], [{ batch: 1, name: '20260715_baseline' }]),
    ).toEqual({ code: 'current', current: true })
  })

  it('rejects missing, extra, invalid-batch, and duplicate migrations', () => {
    expect(assessMigrationState(['baseline'], [])).toMatchObject({ current: false })
    expect(
      assessMigrationState(
        ['baseline'],
        [
          { batch: 1, name: 'baseline' },
          { batch: 2, name: 'unexpected' },
        ],
      ),
    ).toEqual({ code: 'migration_mismatch', current: false })
    expect(assessMigrationState(['baseline'], [{ batch: -1, name: 'dev' }])).toEqual({
      code: 'invalid_migration_batch',
      current: false,
    })
    expect(
      assessMigrationState(
        ['baseline'],
        [
          { batch: 1, name: 'baseline' },
          { batch: 2, name: 'baseline' },
        ],
      ),
    ).toEqual({
      code: 'duplicate_migration',
      current: false,
    })
  })
})
