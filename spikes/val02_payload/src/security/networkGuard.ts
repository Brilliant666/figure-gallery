const forbiddenHostSuffix = '.hpoi.net'

export const isForbiddenHpoiHostname = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '')
  return normalized === 'hpoi.net' || normalized.endsWith(forbiddenHostSuffix)
}

export const assertNoHpoiURL = (value: string, label = 'URL'): URL => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute URL.`)
  }

  if (isForbiddenHpoiHostname(parsed.hostname)) {
    throw new Error(`${label} targets a forbidden Hpoi hostname.`)
  }

  return parsed
}

export const guardedS3Endpoint = (value: string | undefined): string | undefined => {
  const normalized = value?.trim()
  if (!normalized) return undefined
  return assertNoHpoiURL(normalized, 'S3 endpoint').toString()
}

/**
 * Test/runtime helper for code that genuinely needs fetch. The POC currently
 * has no runtime fetch path; this wrapper keeps the network gate explicit.
 */
export const guardedFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input)
  assertNoHpoiURL(url, 'Network request')
  return fetch(input, init)
}
