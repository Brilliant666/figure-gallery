import * as migration_20260715_114831_pr00_baseline from './20260715_114831_pr00_baseline'
import * as migration_20260715_151314_pr01_core_catalog from './20260715_151314_pr01_core_catalog'
import * as migration_20260810_180315_formal_catalog_bridge from './20260810_180315_formal_catalog_bridge'

export const migrations = [
  {
    up: migration_20260715_114831_pr00_baseline.up,
    down: migration_20260715_114831_pr00_baseline.down,
    name: '20260715_114831_pr00_baseline',
  },
  {
    up: migration_20260715_151314_pr01_core_catalog.up,
    down: migration_20260715_151314_pr01_core_catalog.down,
    name: '20260715_151314_pr01_core_catalog',
  },
  {
    up: migration_20260810_180315_formal_catalog_bridge.up,
    down: migration_20260810_180315_formal_catalog_bridge.down,
    name: '20260810_180315_formal_catalog_bridge',
  },
]
