import { open, readFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { ensureRuntimeMarker } from './runtime-root.js'

export const COLLECTOR_LOCK_FILENAME = '.personal-gallery-collector.lock.json'

export class CollectorLockedError extends Error {
  constructor(owner = null) {
    super('Another personal-gallery collection already owns this runtime root.')
    this.name = 'CollectorLockedError'
    this.code = 'COLLECTION_ALREADY_ACTIVE'
    this.owner = owner
  }
}

function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

async function readOwner(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    return { malformed: true }
  }
}

/**
 * Acquire the one cross-process collection slot for a runtime root.
 *
 * The exclusive file is created before any provider exists. Release verifies
 * the random ownership token, so an old owner can never delete a newer lock.
 */
export async function acquireCollectorLock(
  root,
  {
    clock = () => new Date(),
    pid = process.pid,
    tokenFactory = randomUUID,
  } = {},
) {
  const resolvedRoot = path.resolve(root)
  await ensureRuntimeMarker(resolvedRoot)
  const lockPath = path.join(resolvedRoot, COLLECTOR_LOCK_FILENAME)
  const token = tokenFactory()
  const owner = {
    schemaVersion: 1,
    root: resolvedRoot,
    pid,
    token,
    startedAt: clock().toISOString(),
  }

  let handle
  try {
    handle = await open(lockPath, 'wx')
    await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    let released = false
    return {
      owner,
      async release() {
        if (released) return false
        released = true
        const current = await readOwner(lockPath)
        if (
          !current ||
          current.token !== token ||
          typeof current.root !== 'string' ||
          !samePath(current.root, resolvedRoot)
        ) return false
        const releasePath = `${lockPath}.release-${token}`
        try {
          await rename(lockPath, releasePath)
        } catch (error) {
          if (error?.code === 'ENOENT') return false
          throw error
        }
        await rm(releasePath, { force: true })
        return true
      },
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    if (error?.code === 'EEXIST') {
      const current = await readOwner(lockPath)
      // Fail closed even if the recorded PID appears dead. Automatic stale
      // recovery has a read/rename race that could delete a newly acquired
      // lock. The owner must explicitly verify no process is active before
      // manually clearing an abnormal-exit lock.
      throw new CollectorLockedError(current?.malformed ? null : current)
    }
    const current = await readOwner(lockPath)
    if (current?.token === token) await rm(lockPath, { force: true }).catch(() => {})
    throw error
  }
}
