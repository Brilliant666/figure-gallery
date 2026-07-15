import {
  EnvironmentValidationError,
  parseEnvironment,
  type EnvironmentSource,
  type RuntimeEnvironment,
} from '../config/environment'

export type ReadinessCheckStatus = 'fail' | 'not_applicable' | 'not_run' | 'pass'

export interface ReadinessCheckResult {
  code?: string
  status: ReadinessCheckStatus
}

export interface ReadinessBody {
  buildVersion: string
  checks: {
    configuration: ReadinessCheckResult
    database: ReadinessCheckResult
    migrations: ReadinessCheckResult
    storage: ReadinessCheckResult
  }
  status: 'not_ready' | 'ok'
}

export interface ReadinessResult {
  body: ReadinessBody
  status: 200 | 503
}

export interface ReadinessDependencies {
  database: (signal: AbortSignal) => Promise<void>
  migrations: (signal: AbortSignal) => Promise<void>
  storage?: (signal: AbortSignal) => Promise<void>
}

export type ReadinessDependencyFactory = (
  environment: RuntimeEnvironment,
) => ReadinessDependencies | Promise<ReadinessDependencies>

export class ReadinessDependencyError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'ReadinessDependencyError'
    this.code = code
  }
}

async function boundedCheck(
  check: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number,
): Promise<ReadinessCheckResult> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      check(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new ReadinessDependencyError('timeout'))
        }, timeoutMs)
      }),
    ])
    return { status: 'pass' }
  } catch (error) {
    return {
      code: error instanceof ReadinessDependencyError ? error.code : 'unavailable',
      status: 'fail',
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const notRun = (): ReadinessCheckResult => ({ status: 'not_run' })

export async function evaluateReadiness(args: {
  createDependencies: ReadinessDependencyFactory
  source: EnvironmentSource
  timeoutMs?: number
}): Promise<ReadinessResult> {
  const timeoutMs = args.timeoutMs ?? 2_000
  let environment: RuntimeEnvironment

  try {
    environment = parseEnvironment(args.source)
  } catch (error) {
    return {
      body: {
        buildVersion: args.source.BUILD_VERSION?.trim() || 'unknown',
        checks: {
          configuration: {
            code:
              error instanceof EnvironmentValidationError ? 'invalid_environment' : 'unavailable',
            status: 'fail',
          },
          database: notRun(),
          migrations: notRun(),
          storage: notRun(),
        },
        status: 'not_ready',
      },
      status: 503,
    }
  }

  let dependencies: ReadinessDependencies
  try {
    dependencies = await args.createDependencies(environment)
  } catch {
    return {
      body: {
        buildVersion: environment.buildVersion,
        checks: {
          configuration: { status: 'pass' },
          database: { code: 'initialization_failed', status: 'fail' },
          migrations: notRun(),
          storage: notRun(),
        },
        status: 'not_ready',
      },
      status: 503,
    }
  }

  const database = await boundedCheck(dependencies.database, timeoutMs)
  const migrations =
    database.status === 'pass' ? await boundedCheck(dependencies.migrations, timeoutMs) : notRun()
  const storage = dependencies.storage
    ? await boundedCheck(dependencies.storage, timeoutMs)
    : ({ status: 'not_applicable' } satisfies ReadinessCheckResult)
  const isReady =
    database.status === 'pass' &&
    migrations.status === 'pass' &&
    (storage.status === 'pass' || storage.status === 'not_applicable')

  return {
    body: {
      buildVersion: environment.buildVersion,
      checks: {
        configuration: { status: 'pass' },
        database,
        migrations,
        storage,
      },
      status: isReady ? 'ok' : 'not_ready',
    },
    status: isReady ? 200 : 503,
  }
}
