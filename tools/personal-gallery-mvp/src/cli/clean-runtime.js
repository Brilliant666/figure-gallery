#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { Command } from 'commander'

import { loadConfig, validateRuntimeRoot } from '../config.js'
import { assertRuntimeMarker, cleanupConfirmation } from '../storage/runtime-root.js'

const program = new Command()
  .name('personal-gallery-clean-runtime')
  .description('Delete local personal gallery manifests and image objects.')
  .option('--confirm <phrase>', 'required target-bound phrase shown by the first invocation')
program.parse()

let target
try {
  const config = loadConfig()
  target = validateRuntimeRoot(path.resolve(config.root))
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 2
}

const requiredConfirmation = target ? cleanupConfirmation(target) : null
if (target && program.opts().confirm !== requiredConfirmation) {
  process.stderr.write(
    `Refusing to delete runtime data. Review this exact path, then re-run with --confirm ${requiredConfirmation}:\n${target}\n`,
  )
  process.exitCode = 2
} else if (target) {
  try {
    await assertRuntimeMarker(target)
    await fs.rm(target, { recursive: true, force: false })
    process.stdout.write(`Deleted personal gallery runtime: ${target}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 2
  }
}
