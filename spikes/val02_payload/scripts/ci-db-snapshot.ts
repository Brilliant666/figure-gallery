import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getPayload } from 'payload'

import { buildJSONExport } from '@/domain/export'

const outputArg = process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)
if (!outputArg) throw new Error('--out=<runner-temp-json-path> is required.')
if (process.env.PAYLOAD_CI_PRODUCTION_GATE !== 'true') {
  throw new Error('ci-db-snapshot is restricted to the explicit production-gate runner.')
}
if (process.env.DATABASE_ADAPTER !== 'postgres') {
  throw new Error('ci-db-snapshot requires the PostgreSQL adapter.')
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

const digest = (value: unknown): string =>
  createHash('sha256').update(canonical(value), 'utf8').digest('hex')

const { default: config } = await import('@payload-config')
const payload = await getPayload({ config })

try {
  const exported = await buildJSONExport(payload)
  const sortedCollections = Object.fromEntries(
    Object.entries(exported.collections).map(([name, docs]) => [
      name,
      [...docs].sort((left, right) => String(left.id).localeCompare(String(right.id))),
    ]),
  )
  const users = await payload.find({
    collection: 'users',
    depth: 0,
    limit: 0,
    overrideAccess: true,
    showHiddenFields: false,
  })
  const userSummary = users.docs.reduce<Record<string, number>>((summary, user) => {
    const role = String(user.role ?? 'unknown')
    const state = user.candidateActive === false ? 'disabled' : 'active'
    const key = `${role}:${state}`
    summary[key] = (summary[key] ?? 0) + 1
    return summary
  }, {})
  const snapshot = {
    schema_version: 1,
    adapter: 'postgres',
    collection_counts: Object.fromEntries(
      Object.entries(sortedCollections).map(([name, docs]) => [name, docs.length]),
    ),
    data_digest_sha256: digest({
      collections: sortedCollections,
      system_settings: exported.system_settings,
    }),
    formal_main_image_count: sortedCollections['figure-prototypes'].filter(
      (doc) => doc.mainImage !== null && doc.mainImage !== undefined,
    ).length,
    operation_log_count: sortedCollections['operation-logs'].length,
    relation_digest_sha256: digest({
      candidate_images: sortedCollections['candidate-records'].map((doc) => [doc.id, doc.images]),
      main_images: sortedCollections['figure-prototypes'].map((doc) => [doc.id, doc.mainImage]),
      media_owners: sortedCollections.media.map((doc) => [
        doc.id,
        doc.candidate,
        doc.candidateOwner,
        doc.prototype,
        doc.storageKey,
      ]),
      source_prototypes: sortedCollections['source-records'].map((doc) => [
        doc.id,
        doc.prototype,
        doc.invalidated,
      ]),
      version_prototypes: sortedCollections['figure-versions'].map((doc) => [doc.id, doc.prototype]),
    }),
    settings_digest_sha256: digest(exported.system_settings),
    system_settings_count: exported.system_settings ? 1 : 0,
    user_summary: userSummary,
  }
  const output = path.resolve(outputArg)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ output, status: 'snapshot-written' }))
} finally {
  await payload.destroy()
}

process.exit(0)
