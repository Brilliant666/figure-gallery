import * as migration_20260713_190619_val02_initial_schema from './20260713_190619_val02_initial_schema';

export const migrations = [
  {
    up: migration_20260713_190619_val02_initial_schema.up,
    down: migration_20260713_190619_val02_initial_schema.down,
    name: '20260713_190619_val02_initial_schema'
  },
];
