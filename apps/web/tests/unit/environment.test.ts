import { describe, expect, it } from 'vitest'

import {
  EnvironmentValidationError,
  parseEnvironment,
  type EnvironmentSource,
} from '../../src/config/environment'

const filesystemEnvironment = (overrides: EnvironmentSource = {}): EnvironmentSource => ({
  BUILD_VERSION: 'test-build',
  DATABASE_URI: 'postgresql://figure-gallery@127.0.0.1:5432/figure_gallery',
  MEDIA_LOCAL_ROOT: '.runtime/media',
  MEDIA_STORAGE_DRIVER: 'filesystem',
  NODE_ENV: 'test',
  PAYLOAD_SECRET: 'synthetic-test-secret-with-sufficient-length',
  ...overrides,
})

const s3Environment = (overrides: EnvironmentSource = {}): EnvironmentSource => ({
  ...filesystemEnvironment(),
  MEDIA_STORAGE_DRIVER: 's3',
  S3_ACCESS_KEY_ID: 'synthetic-access-key',
  S3_BUCKET: 'synthetic-bucket',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_FORCE_PATH_STYLE: 'true',
  S3_REGION: 'us-east-1',
  S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
  ...overrides,
})

describe('parseEnvironment', () => {
  it('defaults public reading to false', () => {
    expect(parseEnvironment(filesystemEnvironment()).publicReadEnabled).toBe(false)
  })

  it('accepts an HTTP loopback S3 endpoint', () => {
    const parsed = parseEnvironment(s3Environment())
    expect(parsed.s3).toMatchObject({ endpoint: 'http://127.0.0.1:9000', forcePathStyle: true })
  })

  it('rejects filesystem storage in production', () => {
    expect(() => parseEnvironment(filesystemEnvironment({ NODE_ENV: 'production' }))).toThrow(
      EnvironmentValidationError,
    )
  })

  it('rejects SQLite and does not echo configuration values', () => {
    const marker = 'do-not-echo-this-value'
    try {
      parseEnvironment(
        filesystemEnvironment({ DATABASE_URI: `sqlite://${marker}`, PAYLOAD_SECRET: marker }),
      )
      throw new Error('expected validation failure')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError)
      expect(String(error)).not.toContain(marker)
      expect(String(error)).toContain('DATABASE_URI')
    }
  })

  it('requires HTTPS for a non-loopback S3 endpoint', () => {
    expect(() =>
      parseEnvironment(s3Environment({ S3_ENDPOINT: 'http://storage.example.invalid' })),
    ).toThrow(/S3_ENDPOINT/)
    expect(() =>
      parseEnvironment(s3Environment({ S3_ENDPOINT: 'http://127.example.invalid' })),
    ).toThrow(/S3_ENDPOINT/)
  })

  it('uses the WHATWG final host for IPv4 and IPv6 loopback decisions', () => {
    expect(
      parseEnvironment(s3Environment({ S3_ENDPOINT: 'http://2130706433:9000' })).s3?.endpoint,
    ).toBe('http://2130706433:9000')
    expect(parseEnvironment(s3Environment({ S3_ENDPOINT: 'http://[::1]:9000' })).s3?.endpoint).toBe(
      'http://[::1]:9000',
    )
    expect(() =>
      parseEnvironment(s3Environment({ S3_ENDPOINT: 'http://127.0.0.1.example.invalid' })),
    ).toThrow(/S3_ENDPOINT/)
  })

  it('rejects ambiguous authority delimiters and encoded dot segments', () => {
    const endpoints = [
      'https://storage.example.invalid\\@127.0.0.1',
      'https://storage.example.invalid%5c@127.0.0.1',
      'https://storage.example.invalid%2f@127.0.0.1',
      'https://storage.example.invalid/%2e%2e/metadata',
    ]

    for (const endpoint of endpoints) {
      expect(() => parseEnvironment(s3Environment({ S3_ENDPOINT: endpoint }))).toThrow(
        /S3_ENDPOINT/,
      )
    }
  })

  it('rejects cloud metadata and forbidden-host allowlist confusion', () => {
    const forbiddenDomain = `${['h', 'p', 'o', 'i'].join('')}.net`
    const endpoints = [
      'https://169.254.169.254/',
      'https://[fd00:ec2::254]/',
      `https://www.${forbiddenDomain}\\@storage.example.invalid`,
      `https://www.${forbiddenDomain}%5c@storage.example.invalid`,
      `https://storage.example.invalid\\@www.${forbiddenDomain}`,
      `https://storage.example.invalid%5c@www.${forbiddenDomain}`,
    ]

    for (const endpoint of endpoints) {
      expect(() => parseEnvironment(s3Environment({ S3_ENDPOINT: endpoint }))).toThrow(
        /S3_ENDPOINT/,
      )
    }
  })

  it('rejects forbidden source hosts before database or S3 transport', () => {
    const forbiddenDomain = `${['h', 'p', 'o', 'i'].join('')}.net`
    const hostnames = [forbiddenDomain, `www.${forbiddenDomain}`, `RFX.${forbiddenDomain}.`]

    for (const hostname of hostnames) {
      expect(() =>
        parseEnvironment(
          filesystemEnvironment({ DATABASE_URI: `postgresql://figure-gallery@${hostname}/db` }),
        ),
      ).toThrow(/DATABASE_URI/)
      expect(() => parseEnvironment(s3Environment({ S3_ENDPOINT: `https://${hostname}` }))).toThrow(
        /S3_ENDPOINT/,
      )
    }
  })

  it('rejects invalid booleans without echoing the value', () => {
    const marker = 'secret-like-invalid-boolean'
    expect(() => parseEnvironment(filesystemEnvironment({ PUBLIC_READ_ENABLED: marker }))).toThrow(
      /PUBLIC_READ_ENABLED/,
    )
    try {
      parseEnvironment(filesystemEnvironment({ PUBLIC_READ_ENABLED: marker }))
    } catch (error) {
      expect(String(error)).not.toContain(marker)
    }
  })
})
