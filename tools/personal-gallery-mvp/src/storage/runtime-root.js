import { createHash } from 'node:crypto'
import path from 'node:path'

import { atomicWriteJson, readJson } from './json-files.js'

export const RUNTIME_MARKER_FILENAME = '.personal-gallery-runtime.json'
export const RUNTIME_MARKER_KIND = 'figure-gallery-personal-gallery-runtime'

function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export function cleanupConfirmation(root) {
  const digest = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12)
  return `DELETE-PERSONAL-GALLERY-${digest}`
}

export async function ensureRuntimeMarker(root) {
  const resolvedRoot = path.resolve(root)
  const markerPath = path.join(resolvedRoot, RUNTIME_MARKER_FILENAME)
  const existing = await readJson(markerPath)
  if (existing === null) {
    const marker = {
      schemaVersion: 1,
      kind: RUNTIME_MARKER_KIND,
      root: resolvedRoot,
    }
    await atomicWriteJson(markerPath, marker)
    return marker
  }
  if (existing.kind !== RUNTIME_MARKER_KIND || !samePath(existing.root, resolvedRoot)) {
    throw new Error(`Runtime marker does not belong to this directory: ${resolvedRoot}`)
  }
  return existing
}

export async function assertRuntimeMarker(root) {
  const resolvedRoot = path.resolve(root)
  const marker = await readJson(path.join(resolvedRoot, RUNTIME_MARKER_FILENAME))
  if (marker?.kind !== RUNTIME_MARKER_KIND || !samePath(marker?.root, resolvedRoot)) {
    throw new Error(`Refusing cleanup: valid target-bound runtime marker missing at ${resolvedRoot}`)
  }
  return marker
}
