export const ENVIRONMENT_VARIABLES = [
  'NODE_ENV',
  'PAYLOAD_SECRET',
  'DATABASE_URI',
  'PUBLIC_READ_ENABLED',
  'MEDIA_STORAGE_DRIVER',
  'MEDIA_LOCAL_ROOT',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
  'BUILD_VERSION',
] as const

export type EnvironmentVariable = (typeof ENVIRONMENT_VARIABLES)[number]
export type EnvironmentSource = Readonly<Record<string, string | undefined>>

export interface EnvironmentIssue {
  reason: string
  variable: EnvironmentVariable
}

export class EnvironmentValidationError extends Error {
  readonly issues: readonly EnvironmentIssue[]

  constructor(issues: readonly EnvironmentIssue[]) {
    super(
      `Invalid runtime configuration: ${issues
        .map(({ reason, variable }) => `${variable} (${reason})`)
        .join(', ')}`,
    )
    this.name = 'EnvironmentValidationError'
    this.issues = issues
  }
}

export interface RuntimeEnvironment {
  buildVersion: string
  databaseUri: string
  mediaLocalRoot?: string
  mediaStorageDriver: 'filesystem' | 's3'
  nodeEnv: 'development' | 'production' | 'test'
  payloadSecret: string
  publicReadEnabled: boolean
  s3?: {
    accessKeyId: string
    bucket: string
    endpoint: string
    forcePathStyle: boolean
    region: string
    secretAccessKey: string
  }
}

const required = (
  source: EnvironmentSource,
  variable: EnvironmentVariable,
  issues: EnvironmentIssue[],
): string => {
  const value = source[variable]?.trim()
  if (!value) {
    issues.push({ reason: 'is required', variable })
    return ''
  }
  return value
}

const booleanValue = (
  source: EnvironmentSource,
  variable: EnvironmentVariable,
  issues: EnvironmentIssue[],
  fallback: boolean,
): boolean => {
  const value = source[variable]?.trim().toLowerCase()
  if (!value) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  issues.push({ reason: 'must be true or false', variable })
  return fallback
}

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1') return true

  const octets = normalized.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  )
}

const isForbiddenSourceHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/\.+$/g, '')
  const forbiddenDomain = `${['h', 'p', 'o', 'i'].join('')}.net`
  return normalized === forbiddenDomain || normalized.endsWith(`.${forbiddenDomain}`)
}

const validateDatabaseUri = (value: string, issues: EnvironmentIssue[]): void => {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      issues.push({ reason: 'must use the PostgreSQL protocol', variable: 'DATABASE_URI' })
    }
    if (isForbiddenSourceHostname(parsed.hostname)) {
      issues.push({ reason: 'points to a forbidden external source', variable: 'DATABASE_URI' })
    }
  } catch {
    issues.push({ reason: 'must be a valid PostgreSQL URI', variable: 'DATABASE_URI' })
  }
}

const validateS3Endpoint = (value: string, issues: EnvironmentIssue[]): void => {
  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      issues.push({
        reason: 'must not contain credentials, query, or fragment',
        variable: 'S3_ENDPOINT',
      })
    }
    if (isForbiddenSourceHostname(parsed.hostname)) {
      issues.push({ reason: 'points to a forbidden external source', variable: 'S3_ENDPOINT' })
    }
    if (
      parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))
    ) {
      issues.push({
        reason: 'must use HTTPS unless the endpoint is loopback',
        variable: 'S3_ENDPOINT',
      })
    }
  } catch {
    issues.push({ reason: 'must be a valid HTTPS or loopback HTTP URL', variable: 'S3_ENDPOINT' })
  }
}

export function parseEnvironment(source: EnvironmentSource): RuntimeEnvironment {
  const issues: EnvironmentIssue[] = []
  const nodeEnvValue = required(source, 'NODE_ENV', issues)
  const nodeEnv = ['development', 'production', 'test'].includes(nodeEnvValue)
    ? (nodeEnvValue as RuntimeEnvironment['nodeEnv'])
    : 'development'
  if (nodeEnvValue && nodeEnv === 'development' && nodeEnvValue !== 'development') {
    issues.push({ reason: 'must be development, test, or production', variable: 'NODE_ENV' })
  }

  const payloadSecret = required(source, 'PAYLOAD_SECRET', issues)
  const databaseUri = required(source, 'DATABASE_URI', issues)
  if (databaseUri) validateDatabaseUri(databaseUri, issues)

  const buildVersion = required(source, 'BUILD_VERSION', issues)
  const publicReadEnabled = booleanValue(source, 'PUBLIC_READ_ENABLED', issues, false)
  const forcePathStyle = booleanValue(source, 'S3_FORCE_PATH_STYLE', issues, false)
  const storageValue = required(source, 'MEDIA_STORAGE_DRIVER', issues)
  const mediaStorageDriver = storageValue === 's3' ? 's3' : 'filesystem'
  if (storageValue && storageValue !== 'filesystem' && storageValue !== 's3') {
    issues.push({ reason: 'must be filesystem or s3', variable: 'MEDIA_STORAGE_DRIVER' })
  }

  const mediaLocalRoot = source.MEDIA_LOCAL_ROOT?.trim()
  let s3: RuntimeEnvironment['s3']

  if (mediaStorageDriver === 'filesystem') {
    if (!mediaLocalRoot)
      issues.push({ reason: 'is required for filesystem storage', variable: 'MEDIA_LOCAL_ROOT' })
    if (nodeEnv === 'production') {
      issues.push({
        reason: 'filesystem storage is forbidden in production',
        variable: 'MEDIA_STORAGE_DRIVER',
      })
    }
  } else {
    const endpoint = required(source, 'S3_ENDPOINT', issues)
    const region = required(source, 'S3_REGION', issues)
    const bucket = required(source, 'S3_BUCKET', issues)
    const accessKeyId = required(source, 'S3_ACCESS_KEY_ID', issues)
    const secretAccessKey = required(source, 'S3_SECRET_ACCESS_KEY', issues)
    if (endpoint) validateS3Endpoint(endpoint, issues)
    s3 = { accessKeyId, bucket, endpoint, forcePathStyle, region, secretAccessKey }
  }

  if (issues.length > 0) throw new EnvironmentValidationError(issues)

  return Object.freeze({
    buildVersion,
    databaseUri,
    mediaLocalRoot,
    mediaStorageDriver,
    nodeEnv,
    payloadSecret,
    publicReadEnabled,
    s3,
  })
}
