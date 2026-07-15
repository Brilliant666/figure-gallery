import type { PostgresAdapterArgs } from '@payloadcms/db-postgres'

type BeforeSchemaHook = NonNullable<PostgresAdapterArgs['beforeSchemaInit']>[number]

export const RESTRICTED_CATALOG_REFERENCES = [
  ['character_aliases', 'character_id', 'characters'],
  ['characters', 'work_id', 'works'],
  ['figure_prototypes', 'work_id', 'works'],
  ['figure_prototypes', 'manufacturer_id', 'manufacturers'],
  ['figure_prototypes', 'merged_into_id', 'figure_prototypes'],
  ['figure_prototype_characters', 'prototype_id', 'figure_prototypes'],
  ['figure_prototype_characters', 'character_id', 'characters'],
  ['figure_versions', 'prototype_id', 'figure_prototypes'],
] as const

/**
 * Payload relationships default to `ON DELETE SET NULL`. Formal catalog relationships instead
 * retain history and require deletion to go through the audited soft-delete domain commands.
 * Applying that policy to Payload's raw schema keeps generated migrations and runtime drift
 * detection aligned with the hand-reviewed PR-01 migration.
 */
export const applyCatalogForeignKeyPolicy: BeforeSchemaHook = ({ adapter, schema }) => {
  for (const [tableName, columnName, targetTable] of RESTRICTED_CATALOG_REFERENCES) {
    const table = adapter.rawTables[tableName]
    if (!table) {
      throw new Error(`Catalog foreign-key policy could not find table ${tableName}.`)
    }

    const column = Object.values(table.columns).find((candidate) => candidate.name === columnName)
    if (
      !column?.reference ||
      column.reference.table !== targetTable ||
      column.reference.name !== 'id'
    ) {
      throw new Error(
        `Catalog foreign-key policy found an unexpected relationship shape for ${tableName}.${columnName}.`,
      )
    }
    if (!['restrict', 'set null'].includes(column.reference.onDelete)) {
      throw new Error(
        `Catalog foreign-key policy found an unexpected delete policy for ${tableName}.${columnName}.`,
      )
    }
    column.reference.onDelete = 'restrict'
  }

  return schema
}
