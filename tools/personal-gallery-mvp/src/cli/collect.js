#!/usr/bin/env node
import process from 'node:process'
import { Command } from 'commander'

import { liveGate, loadConfig } from '../config.js'
import { createDefaultRuntime } from '../server/runtime-adapter.js'

const config = loadConfig()
const program = new Command()
  .name('personal-gallery-collect')
  .description('Run one explicitly authorized, bounded personal gallery collection.')
  .argument('[query]', 'character name (also accepted positionally for Windows npm forwarding)')
  .option('--query <name>', 'character name')
  .option('--character-url <url>', 'explicit Hpoi character page URL')
  .option('--max-list-pages <count>', 'maximum list pages', String(config.maxListPages))
  .option('--max-products <count>', 'maximum products', String(config.maxProducts))
  .option('--max-images-per-product <count>', 'maximum candidate images per product', String(config.maxImagesPerProduct))
  .option(
    '--confirm-source-permission',
    'confirm that explicit written permission for this automated source access has been obtained',
  )

program.parse()
const options = program.opts()
const query = options.query || program.args[0] || config.defaultQuery
const gate = liveGate(config, { interactiveConfirmation: options.confirmSourcePermission === true })

if (!gate.allowed) {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'environment_blocked',
        query,
        missing: gate.missing,
        notice: gate.notice,
        hpoiRequests: 0,
        firecrawlRequests: 0,
      },
      null,
      2,
    )}\n`,
  )
} else {
  const integer = (value, name, max) => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
      throw new Error(`${name} must be an integer from 1 through ${max}.`)
    }
    return parsed
  }
  const runtime = createDefaultRuntime(config)
  const result = await runtime.runCollector({
    query,
    characterUrl: options.characterUrl || null,
    root: config.root,
    gate,
    limits: {
      maxListPages: integer(options.maxListPages, 'max-list-pages', config.maxListPages),
      maxProducts: integer(options.maxProducts, 'max-products', config.maxProducts),
      maxImagesPerProduct: integer(
        options.maxImagesPerProduct,
        'max-images-per-product',
        config.maxImagesPerProduct,
      ),
    },
    onProgress(progress) {
      process.stdout.write(`${JSON.stringify({ type: 'progress', ...progress })}\n`)
    },
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
