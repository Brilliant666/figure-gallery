import { PolicyFetcher } from './fetcher.js'
import { resolveProfile } from './profiles.js'
import { runPipeline } from './pipeline.js'
import { AccessBlockedError } from './network-policy.js'

function option(args, name, fallback = null) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

const args = process.argv.slice(2)
const mode = args[0]
const profile = resolveProfile(option(args, '--character'))
if (!['sync', 'refresh'].includes(mode) || !profile) {
  console.error('Usage: node src/cli.js <sync|refresh> --character <rem|cheshire>')
  process.exitCode = 2
} else {
  const delayMs = Number(option(args, '--delay-ms', process.env.CHARACTER_FIGURE_REQUEST_DELAY_MS || '1500'))
  try {
    const result = await runPipeline({ mode, profile, fetcher: new PolicyFetcher({ delayMs: Math.max(delayMs, 1500) }) })
    console.log(JSON.stringify({ runtime: result.runtime, ...result.summary }, null, 2))
  } catch (error) {
    if (error instanceof AccessBlockedError) {
      console.error(JSON.stringify({ status: 'blocked', reason: error.reason, statusCode: error.status, url: error.url }, null, 2))
      process.exitCode = 3
    } else {
      console.error(error?.stack || error)
      process.exitCode = 1
    }
  }
}
