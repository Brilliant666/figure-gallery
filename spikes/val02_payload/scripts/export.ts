import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getPayload } from 'payload'

import { buildCSVExports, buildJSONExport, exportFieldGuide } from '@/domain/export'

if (!process.env.PAYLOAD_SECRET) throw new Error('PAYLOAD_SECRET is required at runtime.')

const outArg = process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)
const outputDir = path.resolve(outArg ?? path.join(os.tmpdir(), 'figure-gallery-val02-payload-export'))
const { default: config } = await import('@payload-config')
const payload = await getPayload({ config })

try {
  const json = await buildJSONExport(payload)
  const csvFiles = buildCSVExports(json)
  await mkdir(outputDir, { recursive: true })
  await writeFile(
    path.join(outputDir, 'figure-gallery.json'),
    `${JSON.stringify({ ...json, field_guide: exportFieldGuide }, null, 2)}\n`,
    'utf8',
  )
  for (const [name, contents] of Object.entries(csvFiles)) {
    await writeFile(path.join(outputDir, name), `${contents}\n`, 'utf8')
  }
  console.log(JSON.stringify({ csv_files: Object.keys(csvFiles).length, output_dir: outputDir }))
} finally {
  await payload.destroy()
}
