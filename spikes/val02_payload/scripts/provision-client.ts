import { getPayload } from 'payload'

const token = process.env.VAL02_PAYLOAD_CANDIDATE_TOKEN?.trim()
if (!token) throw new Error('VAL02_PAYLOAD_CANDIDATE_TOKEN must be supplied at runtime.')
if (!process.env.PAYLOAD_SECRET) throw new Error('PAYLOAD_SECRET must be supplied at runtime.')

const email = 'val02-payload-client@synthetic.invalid'
const { default: config } = await import('@payload-config')
const payload = await getPayload({ config })

try {
  const existing = await payload.find({
    collection: 'users',
    limit: 1,
    overrideAccess: true,
    where: { email: { equals: email } },
  })
  const data = {
    apiKey: token,
    email,
    enableAPIKey: true,
    role: 'candidate-client' as const,
  }
  const user = existing.docs[0]
    ? await payload.update({
        collection: 'users',
        data,
        id: existing.docs[0].id,
        overrideAccess: true,
      })
    : await payload.create({
        collection: 'users',
        data: { ...data, password: `${crypto.randomUUID()}-${crypto.randomUUID()}` },
        overrideAccess: true,
      })
  console.log(JSON.stringify({ role: user.role, status: 'runtime-client-provisioned', user_id: user.id }))
} finally {
  await payload.destroy()
}
