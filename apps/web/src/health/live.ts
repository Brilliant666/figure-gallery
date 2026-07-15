export interface LiveHealthBody {
  buildVersion: string
  checks: {
    process: { status: 'pass' }
  }
  status: 'ok'
}

export function buildLiveHealth(
  source: Readonly<Record<string, string | undefined>>,
): LiveHealthBody {
  return {
    buildVersion: source.BUILD_VERSION?.trim() || 'unknown',
    checks: { process: { status: 'pass' } },
    status: 'ok',
  }
}
