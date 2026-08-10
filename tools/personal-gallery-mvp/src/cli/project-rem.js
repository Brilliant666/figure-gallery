#!/usr/bin/env node
import path from 'node:path'
import process from 'node:process'
import { Command } from 'commander'

import { buildProjectionFromCollector } from '../projection/prototype-projection.js'

const program = new Command()
  .name('personal-gallery-project-rem')
  .description('Project the frozen Rem Catalog Items into reversible local pose prototypes.')
  .requiredOption('--collector-root <path>', 'read-only rem-figure-collector directory')
  .requiredOption('--output <path>', 'runtime prototype-projection.json destination')

program.parse()
const options = program.opts()
const projection = await buildProjectionFromCollector({
  collectorRoot: path.resolve(options.collectorRoot),
  outputPath: path.resolve(options.output),
  strictFrozenBaseline: true,
})

process.stdout.write(`${JSON.stringify({
  status: 'completed',
  output: path.resolve(options.output),
  ...projection.summary,
  hpoiRequests: 0,
  networkRequests: 0,
}, null, 2)}\n`)
