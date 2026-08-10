#!/usr/bin/env node
import path from 'node:path'
import process from 'node:process'
import { Command } from 'commander'

import { resolveBuiltinCharacter } from '../characters/registry.js'
import { buildCharacterProjectionFromFiles } from '../projection/prototype-projection.js'

const program = new Command()
  .name('personal-gallery-project-character')
  .description('Project a local character Catalog into stable personal-gallery pose prototypes.')
  .requiredOption('--character <slug-or-alias>', 'built-in Character Profile slug or alias')
  .requiredOption('--catalog <path>', 'local figures-like Catalog JSON')
  .requiredOption('--grouping <path>', 'local deterministic grouping JSON')
  .requiredOption('--review <path>', 'local frozen review-decision JSON')
  .requiredOption('--output <path>', 'runtime prototype-projection.json destination')
  .option('--identity-registry <path>', 'character-scoped stable identity registry destination')
  .option('--preferences <path>', 'character-scoped preferences file')
  .option('--legacy-preference-map <path>', 'explicit legacy product/Catalog Item/image mapping JSON')

program.parse()
const options = program.opts()
const character = resolveBuiltinCharacter(options.character)
if (!character) throw new Error(`Unknown Character Profile: ${options.character}`)

const projection = await buildCharacterProjectionFromFiles({
  character,
  catalogPath: path.resolve(options.catalog),
  groupingPath: path.resolve(options.grouping),
  reviewPath: path.resolve(options.review),
  outputPath: path.resolve(options.output),
  ...(options.identityRegistry
    ? { identityRegistryPath: path.resolve(options.identityRegistry) }
    : {}),
  ...(options.preferences ? { preferencesPath: path.resolve(options.preferences) } : {}),
  ...(options.legacyPreferenceMap
    ? { catalogPreferenceMapPath: path.resolve(options.legacyPreferenceMap) }
    : {}),
})

process.stdout.write(`${JSON.stringify({
  status: 'completed',
  characterSlug: character.slug,
  output: path.resolve(options.output),
  ...projection.summary,
  identity: projection.identity,
  preferenceMigration: projection.buildResult.preferenceMigration,
  preferenceBackupCreated: projection.buildResult.preferenceBackup.created,
  hpoiRequests: 0,
  networkRequests: 0,
}, null, 2)}\n`)
