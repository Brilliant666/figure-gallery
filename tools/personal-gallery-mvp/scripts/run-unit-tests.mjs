import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testsRoot = path.join(toolRoot, 'tests')

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) return entry.name === 'e2e' ? [] : findTests(target)
      return entry.name.endsWith('.test.js') ? [target] : []
    })
    .sort()
}

const tests = findTests(testsRoot)
if (!tests.length) throw new Error('No offline unit tests were found.')

execFileSync(
  process.execPath,
  [
    '--import',
    pathToFileURL(path.join(testsRoot, 'helpers', 'network-guard.js')).href,
    '--test',
    '--test-concurrency=1',
    ...tests,
  ],
  { cwd: toolRoot, stdio: 'inherit' },
)
