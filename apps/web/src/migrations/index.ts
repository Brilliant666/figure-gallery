import * as migration_20260715_114831_pr00_baseline from './20260715_114831_pr00_baseline'

export const migrations = [
  {
    up: migration_20260715_114831_pr00_baseline.up,
    down: migration_20260715_114831_pr00_baseline.down,
    name: '20260715_114831_pr00_baseline',
  },
]
