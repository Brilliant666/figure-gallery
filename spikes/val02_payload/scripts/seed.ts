import { getPayload } from 'payload'

import { loadDomainFixture } from '@/domain/fixture'
import { seedPayload } from '@/domain/seed'

if (!process.env.PAYLOAD_SECRET) {
  throw new Error('PAYLOAD_SECRET must be generated and supplied at runtime.')
}

const { digest, fixture } = await loadDomainFixture()
const { default: config } = await import('@payload-config')
const payload = await getPayload({ config })

try {
  const maps = await seedPayload(payload, fixture as never)
  console.log(
    JSON.stringify({
      candidates: maps.candidates.size,
      fixture_sha256: digest,
      media: maps.media.size,
      prototypes: maps.prototypes.size,
      status: 'seeded',
    }),
  )
} finally {
  await payload.destroy()
}
