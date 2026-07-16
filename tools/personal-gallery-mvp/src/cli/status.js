#!/usr/bin/env node
import { loadConfig } from '../config.js'
import { listRecentRuns } from '../gallery/read-model.js'

const config = loadConfig()
const recentRuns = await listRecentRuns(config.root, 20)
process.stdout.write(
  `${JSON.stringify(
    {
      root: config.root,
      status: recentRuns.length ? 'history_available' : 'empty',
      recentRuns,
    },
    null,
    2,
  )}\n`,
)
