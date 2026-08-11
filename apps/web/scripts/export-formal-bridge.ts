import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FormalBridgeError,
  buildFormalBridgeExport,
  resolveFormalBridgeInputPaths,
  writeFormalBridgeExport,
} from '../src/formal-bridge/export'

interface CliOptions {
  cheshireCatalogPath?: string
  outputDirectory: string
  remCatalogPath: string
  runtimeRoot: string
}

function usage(): string {
  return [
    'Usage: npm run export:formal-bridge -- --runtime-root <.local root> --rem-catalog <figures.json> [options]',
    '',
    'Options:',
    '  --cheshire-catalog <projection-input.json>  Override the Cheshire Collector input.',
    '  --output <directory>                        Output directory (default: repo .local/formal-bridge).',
    '  --help                                      Show this message.',
    '',
    'Environment equivalents:',
    '  FORMAL_BRIDGE_RUNTIME_ROOT',
    '  FORMAL_BRIDGE_REM_CATALOG',
    '  FORMAL_BRIDGE_CHESHIRE_CATALOG',
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
  const known = new Set([
    '--cheshire-catalog',
    '--help',
    '--output',
    '--rem-catalog',
    '--runtime-root',
  ])
  for (const argument of args.filter((value) => value.startsWith('--'))) {
    if (!known.has(argument)) {
      throw new FormalBridgeError('cli', 'option', argument, 'Unknown command-line option.')
    }
  }
  const runtimeRoot = optionValue(args, '--runtime-root') ?? process.env.FORMAL_BRIDGE_RUNTIME_ROOT
  const remCatalogPath = optionValue(args, '--rem-catalog') ?? process.env.FORMAL_BRIDGE_REM_CATALOG
  if (!runtimeRoot) {
    throw new FormalBridgeError(
      'cli',
      'option',
      '--runtime-root',
      'Provide --runtime-root or FORMAL_BRIDGE_RUNTIME_ROOT.',
    )
  }
  if (!remCatalogPath) {
    throw new FormalBridgeError(
      'cli',
      'option',
      '--rem-catalog',
      'Provide --rem-catalog or FORMAL_BRIDGE_REM_CATALOG.',
    )
  }
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const defaultOutput = resolve(scriptDirectory, '../../..', '.local', 'formal-bridge')
  return {
    cheshireCatalogPath:
      optionValue(args, '--cheshire-catalog') ?? process.env.FORMAL_BRIDGE_CHESHIRE_CATALOG,
    outputDirectory:
      optionValue(args, '--output') ?? process.env.FORMAL_BRIDGE_OUTPUT_DIR ?? defaultOutput,
    remCatalogPath,
    runtimeRoot,
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const result = await buildFormalBridgeExport(
    resolveFormalBridgeInputPaths({
      cheshireCatalogPath: options.cheshireCatalogPath,
      remCatalogPath: options.remCatalogPath,
      runtimeRoot: options.runtimeRoot,
    }),
  )
  await writeFormalBridgeExport(options.outputDirectory, result)
  process.stdout.write(
    `${JSON.stringify(
      {
        contentDigest: result.bundle.contentDigest,
        counts: result.validation.counts,
        status: 'success',
      },
      null,
      2,
    )}\n`,
  )
}

main().catch((error: unknown) => {
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
  process.exitCode = 1
})
