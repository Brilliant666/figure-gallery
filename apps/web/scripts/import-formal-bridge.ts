import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPayload, type Payload } from 'payload'

import config from '../src/payload.config'
import {
  FormalBridgeError,
  readFormalBridgeBundle,
  validateFormalBridgeBundle,
  validateFormalBridgeParity,
} from '../src/formal-bridge/export'
import { importFormalBridgeBundle } from '../src/formal-bridge/importer'
import { readFormalBridgeBundleFromPayload } from '../src/formal-bridge/readback'

interface CliOptions {
  inputPath: string
  outputDirectory: string
}

function usage(): string {
  return [
    'Usage: npm run import:formal-bridge -- --input <catalog-export.json> [options]',
    '',
    'Options:',
    '  --output <directory>  Read-back and summary output (default: repo .local/formal-bridge).',
    '  --help                Show this message.',
    '',
    'Environment equivalents:',
    '  FORMAL_BRIDGE_IMPORT_FILE',
    '  FORMAL_BRIDGE_OUTPUT_DIR',
  ].join('\n')
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new FormalBridgeError('cli', 'option', name, `Missing value for ${name}.`)
  }
  return value
}

function parseOptions(args: string[]): CliOptions {
  if (args.includes('--help')) {
    process.stdout.write(`${usage()}\n`)
    process.exit(0)
  }
  const known = new Set(['--help', '--input', '--output'])
  for (const argument of args.filter((value) => value.startsWith('--'))) {
    if (!known.has(argument)) {
      throw new FormalBridgeError('cli', 'option', argument, 'Unknown command-line option.')
    }
  }
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const outputDirectory =
    optionValue(args, '--output') ??
    process.env.FORMAL_BRIDGE_OUTPUT_DIR ??
    resolve(scriptDirectory, '../../..', '.local', 'formal-bridge')
  const inputPath =
    optionValue(args, '--input') ??
    process.env.FORMAL_BRIDGE_IMPORT_FILE ??
    resolve(outputDirectory, 'catalog-export.json')
  return { inputPath, outputDirectory }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const bundle = await readFormalBridgeBundle(options.inputPath)
  let payload: Payload | undefined
  try {
    payload = await getPayload({ config })
    const importSummary = await importFormalBridgeBundle(payload, bundle)
    const readback = await readFormalBridgeBundleFromPayload(payload)
    const readbackValidation = validateFormalBridgeBundle(readback)
    const parity = validateFormalBridgeParity(bundle, readback)
    const summary = {
      import: importSummary,
      parity,
      readback: readbackValidation,
      status: 'success',
    }
    await mkdir(options.outputDirectory, { recursive: true })
    await Promise.all([
      writeFile(
        resolve(options.outputDirectory, 'formal-readback.json'),
        `${JSON.stringify(readback, null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        resolve(options.outputDirectory, 'import-summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
        'utf8',
      ),
    ])
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } finally {
    await payload?.destroy()
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    const failure =
      error instanceof FormalBridgeError
        ? error.toJSON()
        : {
            error: error instanceof Error ? error.message : String(error),
            phase: 'cli',
            recordType: 'unknown',
            stableKey: 'unknown',
          }
    process.stderr.write(`${JSON.stringify(failure)}\n`)
    process.exit(1)
  },
)
