import { describe, expect, it } from 'vitest'

import {
  RESTRICTED_CATALOG_REFERENCES,
  applyCatalogForeignKeyPolicy,
} from '../../src/db/catalog-foreign-key-policy'

type HookArguments = Parameters<typeof applyCatalogForeignKeyPolicy>[0]

function hookArguments(
  overrides: Record<
    string,
    { name: string; reference: { name: string; onDelete: string; table: string } }
  > = {},
): HookArguments {
  const rawTables: Record<string, { columns: Record<string, unknown>; name: string }> = {}
  for (const [tableName, columnName, targetTable] of RESTRICTED_CATALOG_REFERENCES) {
    const table = (rawTables[tableName] ??= { columns: {}, name: tableName })
    table.columns[columnName] = overrides[`${tableName}.${columnName}`] ?? {
      name: columnName,
      reference: { name: 'id', onDelete: 'set null', table: targetTable },
    }
  }
  rawTables.works = {
    columns: {
      createdBy: {
        name: 'created_by_id',
        reference: { name: 'id', onDelete: 'set null', table: 'users' },
      },
    },
    name: 'works',
  }

  return {
    adapter: { rawTables },
    extendTable: () => undefined,
    schema: { enums: {}, relations: {}, tables: {} },
  } as unknown as HookArguments
}

describe('catalog PostgreSQL foreign-key policy', () => {
  it('changes only the twelve allowlisted formal relationships to RESTRICT', async () => {
    const args = hookArguments()
    const returnedSchema = await applyCatalogForeignKeyPolicy(args)

    expect(returnedSchema).toBe(args.schema)
    for (const [tableName, columnName] of RESTRICTED_CATALOG_REFERENCES) {
      const column = args.adapter.rawTables[tableName]?.columns[columnName]
      expect(column?.reference?.onDelete).toBe('restrict')
    }
    expect(args.adapter.rawTables.works?.columns.createdBy?.reference?.onDelete).toBe('set null')
  })

  it('fails closed if Payload changes a relationship target or delete-policy shape', () => {
    const wrongTarget = hookArguments({
      'characters.work_id': {
        name: 'work_id',
        reference: { name: 'id', onDelete: 'set null', table: 'users' },
      },
    })
    expect(() => applyCatalogForeignKeyPolicy(wrongTarget)).toThrow('unexpected relationship shape')

    const wrongPolicy = hookArguments({
      'characters.work_id': {
        name: 'work_id',
        reference: { name: 'id', onDelete: 'cascade', table: 'works' },
      },
    })
    expect(() => applyCatalogForeignKeyPolicy(wrongPolicy)).toThrow('unexpected delete policy')
  })
})
