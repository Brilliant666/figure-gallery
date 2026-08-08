import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(path.join(toolRoot, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(path.join(toolRoot, 'package-lock.json'), 'utf8'))
const errors = []

function runNpm(args) {
  const npmExecPath = process.env.npm_execpath
  const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const commandArgs = npmExecPath ? [npmExecPath, ...args] : args
  const result = spawnSync(command, commandArgs, {
    cwd: toolRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: !npmExecPath && process.platform === 'win32',
  })
  if (result.error) throw result.error
  return result
}

const omit = runNpm(['config', 'get', 'omit']).stdout.trim()
const optional = runNpm(['config', 'get', 'optional']).stdout.trim()
const optionalDependenciesEnabled =
  !omit.split(/[\s,]+/u).includes('optional') && optional !== 'false'
if (!optionalDependenciesEnabled) {
  errors.push('npm optional dependencies are disabled')
}

const treeResult = runNpm(['ls', '--depth=0', '--json'])
let tree
try {
  tree = JSON.parse(treeResult.stdout)
} catch {
  errors.push('npm ls did not return valid JSON')
  tree = {}
}

const allowedSharpOptionalOrphans = new Set([
  '@emnapi/runtime@1.11.2',
  '@img/sharp-wasm32@0.35.3',
  'tslib@2.8.1',
])
const acceptedOptionalOrphans = []
const treeProblems = tree.problems || []
for (const problem of treeProblems) {
  const match = /^extraneous: (.+?) /u.exec(problem)
  const identity = match?.[1]
  if (!identity || !allowedSharpOptionalOrphans.has(identity)) {
    errors.push(`npm dependency tree problem: ${problem}`)
    continue
  }
  const at = identity.lastIndexOf('@')
  const name = identity.slice(0, at)
  if (lock.packages?.[`node_modules/${name}`]?.optional !== true) {
    errors.push(`${identity} is not marked optional in package-lock.json`)
    continue
  }
  acceptedOptionalOrphans.push(identity)
}
if (treeResult.status !== 0 && treeProblems.length === 0) {
  errors.push(`npm ls exited ${treeResult.status} without a classified dependency-tree problem`)
}
if (tree.error) errors.push(`npm ls error: ${tree.error.summary || tree.error.code || 'unknown'}`)

for (const [name, expected] of Object.entries({
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
})) {
  const installed = JSON.parse(
    readFileSync(path.join(toolRoot, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'),
  )
  if (installed.version !== expected) {
    errors.push(`${name}: installed ${installed.version}, expected ${expected}`)
  }
}

if (sharp.versions?.sharp !== packageJson.dependencies.sharp || !sharp.versions?.vips) {
  errors.push(`Sharp runtime mismatch: ${sharp.versions?.sharp || 'missing'}`)
}

const source = sharp({
  create: {
    width: 4,
    height: 3,
    channels: 4,
    background: { r: 34, g: 91, b: 146, alpha: 1 },
  },
})
const formats = {}
for (const format of ['png', 'jpeg', 'webp']) {
  const buffer = await source.clone()[format]().toBuffer()
  const metadata = await sharp(buffer).metadata()
  formats[format] = {
    bytes: buffer.length,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
  }
  if (
    buffer.length === 0 ||
    metadata.format !== format ||
    metadata.width !== 4 ||
    metadata.height !== 3
  ) {
    errors.push(`Sharp ${format} encode/metadata check failed`)
  }
}

const resized = await source.clone().resize(2, 2).png().toBuffer()
const resizedMetadata = await sharp(resized).metadata()
if (resizedMetadata.width !== 2 || resizedMetadata.height !== 2 || resizedMetadata.format !== 'png') {
  errors.push('Sharp resize/metadata check failed')
}

const summary = {
  status: errors.length === 0 ? 'pass' : 'fail',
  node: process.version,
  npmOptionalDependenciesEnabled: optionalDependenciesEnabled,
  npmLsExitCode: treeResult.status,
  acceptedSharpOptionalOrphans: acceptedOptionalOrphans,
  sharp: sharp.versions?.sharp,
  libvips: sharp.versions?.vips,
  formats,
  resize: {
    format: resizedMetadata.format,
    width: resizedMetadata.width,
    height: resizedMetadata.height,
  },
  errors,
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
if (errors.length > 0) process.exitCode = 1
