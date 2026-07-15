import { buildLiveHealth } from '../../../../health/live'

export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json(buildLiveHealth(process.env), {
    headers: { 'cache-control': 'no-store' },
    status: 200,
  })
}
