import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { CandidateRecords } from '@/collections/CandidateRecords'
import { FigurePrototypes } from '@/collections/FigurePrototypes'
import { Media } from '@/collections/Media'

describe('Payload-native configuration', () => {
  it('uses drafts/trash, relationships and upload image sizes', () => {
    expect(FigurePrototypes.versions).toMatchObject({ drafts: true })
    expect(FigurePrototypes.trash).toBe(true)
    expect(
      FigurePrototypes.fields.some(
        (field) => 'name' in field && field.name === 'characters' && field.type === 'relationship',
      ),
    ).toBe(true)
    expect(typeof Media.upload === 'object' ? Media.upload : {}).toMatchObject({
      filesRequiredOnCreate: false,
    })
    expect(
      typeof Media.upload === 'object' && 'imageSizes' in Media.upload ? Media.upload.imageSizes : [],
    ).toHaveLength(2)
    expect(
      Array.isArray(CandidateRecords.endpoints)
        ? CandidateRecords.endpoints.map((endpoint) => endpoint.path)
        : [],
    ).toEqual([
      '/upsert',
      '/review-action',
    ])
  })

  it('keeps the candidate review custom view server-guarded', async () => {
    const view = await readFile(
      path.resolve('src/components/admin/CandidateReviewView.tsx'),
      'utf8',
    )
    expect(view).toContain('if (!isAdminUser(req.user))')
    expect(view).toContain('Administrator access is required.')
    expect(view).not.toContain('src={image.sourceUrl}')
  })

  it('configures real SQLite transactions and optional official S3 storage', async () => {
    const config = await readFile(path.resolve('src/payload.config.ts'), 'utf8')
    const packageDocument = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(config).toContain("transactionOptions: { behavior: 'immediate' }")
    expect(config).toContain('s3Storage({')
    expect(config).toContain("if (process.env.S3_ENABLED !== 'true') return []")
    expect(config).toContain("required('S3_ACCESS_KEY_ID')")
    expect(config).toContain('guardedS3Endpoint(process.env.S3_ENDPOINT)')
    expect(packageDocument.scripts.dev).toContain('-H 127.0.0.1')
    expect(packageDocument.scripts.start).toContain('-H 127.0.0.1')
  })
})
