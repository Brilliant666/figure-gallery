import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export async function readJson(filePath, fallback = null) {
  try {
    const text = await readFile(filePath, 'utf8')
    return JSON.parse(text)
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

export async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temporaryPath, 'wx')
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, filePath)
  } finally {
    if (handle) await handle.close().catch(() => {})
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

export async function updateJson(filePath, fallback, mutate) {
  const current = await readJson(filePath, fallback)
  const next = await mutate(structuredClone(current))
  await atomicWriteJson(filePath, next)
  return next
}
