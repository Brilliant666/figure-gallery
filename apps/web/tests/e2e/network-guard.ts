import { expect, type Page } from '@playwright/test'

const isLoopback = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1') return true

  const octets = normalized.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  )
}

export function monitorLoopbackRequests(page: Page): () => void {
  const externalHostnames: string[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !isLoopback(url.hostname)) {
      externalHostnames.push(url.hostname)
    }
  })

  return () => {
    expect(externalHostnames, 'externalRequestCount must remain zero').toEqual([])
  }
}
