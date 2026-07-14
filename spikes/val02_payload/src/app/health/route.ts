export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ service: 'val02-payload-spike', status: 'ok' })
}
