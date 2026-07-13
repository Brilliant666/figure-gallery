import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const fixturePath = path.resolve(
  process.cwd(),
  '..',
  'val02_contract',
  'fixtures',
  'domain_fixture.json',
)

export const loadDomainFixture = async <T = Record<string, unknown>>(): Promise<{
  digest: string
  fixture: T
}> => {
  const bytes = await readFile(fixturePath)
  return {
    digest: createHash('sha256').update(bytes).digest('hex'),
    fixture: JSON.parse(bytes.toString('utf8')) as T,
  }
}
