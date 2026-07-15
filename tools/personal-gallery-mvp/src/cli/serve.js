#!/usr/bin/env node
import process from 'node:process'

import { loadConfig } from '../config.js'
import { createPersonalGalleryServer } from '../server/server.js'

const config = loadConfig()
const application = createPersonalGalleryServer({ config })
await application.listen()

process.stdout.write(
  `Personal Figure Gallery is available at http://${config.host}:${config.port}/\n` +
    'Live collection remains gated by source permission, explicit configuration, and per-run confirmation.\n',
)

async function shutdown() {
  await application.close()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
