import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const applicationRoot = fileURLToPath(new URL('../../', import.meta.url))
const forbiddenRuntimeRoots = [['sp', 'ikes'].join(''), ['re', 'search'].join('')]

describe('formal dependency boundary', () => {
  it('does not point package or TypeScript configuration at non-runtime history', () => {
    const configuration = ['package.json', 'tsconfig.json']
      .map((name) => readFileSync(path.join(applicationRoot, name), 'utf8'))
      .join('\n')

    for (const root of forbiddenRuntimeRoots) {
      expect(configuration.toLowerCase()).not.toContain(root)
    }
  })
})
