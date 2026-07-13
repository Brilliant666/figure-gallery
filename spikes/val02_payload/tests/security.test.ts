import { describe, expect, it, vi } from 'vitest'

import { candidateMediaBoundary } from '@/hooks/candidateMediaBoundary'
import { protectMainImage } from '@/hooks/protectMainImage'
import { canonicalizeSourceURL, makeSourceKey } from '@/domain/sourceKey'
import {
  assertNoHpoiURL,
  guardedFetch,
  guardedS3Endpoint,
  isForbiddenHpoiHostname,
} from '@/security/networkGuard'

const request = (role?: 'admin' | 'candidate-client', context: Record<string, unknown> = {}) =>
  ({
    context,
    payloadAPI: 'REST',
    user: role ? { id: role, role } : null,
  }) as never

describe('source identity and Hpoi network gate', () => {
  it('prefers stable source ID and canonicalizes the fallback URL', () => {
    expect(
      makeSourceKey({
        sourceItemId: 'S-1',
        sourceType: 'Synthetic',
        sourceUrl: 'https://synthetic.invalid/item?utm_source=test',
      }),
    ).toBe('synthetic:id:S-1')
    expect(
      canonicalizeSourceURL(
        'https://SYNTHETIC.invalid/item/?z=2&utm_source=test&a=1#fragment',
      ),
    ).toBe('https://synthetic.invalid/item?a=1&z=2')
  })

  it.each(['hpoi.net', 'www.hpoi.net', 'rfx.hpoi.net', 'deep.assets.hpoi.net'])(
    'blocks %s and every Hpoi subdomain',
    (host) => {
      expect(isForbiddenHpoiHostname(host)).toBe(true)
      expect(() => assertNoHpoiURL(`https://${host}/anything`)).toThrow(/forbidden Hpoi/)
    },
  )

  it('rejects before invoking the underlying fetch', async () => {
    const original = globalThis.fetch
    const spy = vi.fn()
    globalThis.fetch = spy as typeof fetch
    try {
      await expect(guardedFetch('https://www.hpoi.net/')).rejects.toThrow(/forbidden Hpoi/)
      expect(() => guardedS3Endpoint('https://hpoi.net/storage')).toThrow(/forbidden Hpoi/)
      expect(() => guardedS3Endpoint('https://deep.assets.hpoi.net/storage')).toThrow(
        /forbidden Hpoi/,
      )
      expect(guardedS3Endpoint('https://objects.synthetic.invalid/storage')).toBe(
        'https://objects.synthetic.invalid/storage',
      )
      expect(spy).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('candidate and main-image guards', () => {
  it('allows main-image changes only through the audited administrator review context', async () => {
    const args = { data: { mainImage: 2 }, originalDoc: { mainImage: 1 } }
    expect(() =>
      protectMainImage({ ...args, req: request('candidate-client') } as never),
    ).toThrow(/audited administrator review/)
    expect(() => protectMainImage({ ...args, req: request() } as never)).toThrow(
      /audited administrator review/,
    )
    expect(() =>
      protectMainImage({ ...args, req: request('admin', { candidateSync: true }) } as never),
    ).toThrow(/audited administrator review/)
    expect(() => protectMainImage({ ...args, req: request('admin') } as never)).toThrow(
      /audited administrator review/,
    )
    expect(
      protectMainImage({
        ...args,
        req: request('admin', { manualMainImageReview: true }),
      } as never),
    ).toEqual({ mainImage: 2 })
  })

  it('forces candidate media to remain outside the formal pool', async () => {
    const result = await candidateMediaBoundary({
      data: {
        candidate: 3,
        candidateOnly: false,
        selectedAsMain: false,
        sourceUrl: 'https://synthetic.invalid/image.png',
      },
      req: request('candidate-client'),
    } as never)
    expect(result).toMatchObject({ candidateOnly: true, prototype: null, selectedAsMain: false })

    expect(() =>
      candidateMediaBoundary({
        data: {
          candidate: 3,
          prototype: 5,
          sourceUrl: 'https://synthetic.invalid/image.png',
        },
        req: request('candidate-client'),
      } as never),
    ).toThrow(/cannot attach formal media/)
  })
})
