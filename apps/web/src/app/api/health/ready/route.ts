import { runRuntimeReadiness } from '../../../../health/runtime-readiness'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const result = await runRuntimeReadiness()
  return Response.json(result.body, {
    headers: { 'cache-control': 'no-store' },
    status: result.status,
  })
}
