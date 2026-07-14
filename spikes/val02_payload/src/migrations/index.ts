import * as migration_20260713_190619_val02_initial_schema from './20260713_190619_val02_initial_schema';
import * as migration_20260714_044222_val02b_decision_gates from './20260714_044222_val02b_decision_gates';

export const migrations = [
  {
    up: migration_20260713_190619_val02_initial_schema.up,
    down: migration_20260713_190619_val02_initial_schema.down,
    name: '20260713_190619_val02_initial_schema',
  },
  {
    up: migration_20260714_044222_val02b_decision_gates.up,
    down: migration_20260714_044222_val02b_decision_gates.down,
    name: '20260714_044222_val02b_decision_gates'
  },
];
