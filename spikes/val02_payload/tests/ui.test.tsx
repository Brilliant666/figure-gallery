import { readFile } from 'node:fs/promises'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { GalleryGrid } from '@/components/frontend/GalleryGrid'
import { findCandidateByID } from '@/components/admin/CandidateReviewClient'

describe('minimal read-only gallery UI', () => {
  it('keeps Payload numeric candidate ids selectable after a DOM string change event', () => {
    const candidates = [
      { id: 1, images: [], rawFields: {}, reason: '', status: 'pending', targetPrototypeID: 11 },
      { id: 2, images: [], rawFields: {}, reason: '', status: 'pending', targetPrototypeID: 22 },
    ]
    expect(findCandidateByID(candidates, '2')?.targetPrototypeID).toBe(22)
  })

  it('renders multiple original-ratio image elements without a download control', () => {
    const html = renderToStaticMarkup(
      <GalleryGrid
        images={[
          { alt: 'Synthetic A', height: 60, id: 'a', isGroup: false, url: '/media/a.png', width: 40 },
          { alt: 'Synthetic B', height: 40, id: 'b', isGroup: true, url: '/media/b.png', width: 60 },
        ]}
      />,
    )
    expect(html.match(/<img/g)).toHaveLength(2)
    expect(html).toContain('width="40"')
    expect(html).toContain('height="60"')
    expect(html).toContain('width="60"')
    expect(html).toContain('height="40"')
    expect(html).toContain('多人')
    expect(html).not.toContain('download')
  })

  it('declares 4/3/2 responsive columns, original ratio and lightbox controls', async () => {
    const css = await readFile(path.resolve('src/app/(frontend)/styles.css'), 'utf8')
    const component = await readFile(path.resolve('src/components/frontend/GalleryGrid.tsx'), 'utf8')
    expect(css).toContain('repeat(4, minmax(0, 1fr))')
    expect(css).toContain('repeat(3, minmax(0, 1fr))')
    expect(css).toContain('repeat(2, minmax(0, 1fr))')
    expect(css).toContain('height: auto')
    expect(css).toContain('object-fit: contain')
    expect(component).toContain('aria-label="关闭"')
    expect(component).toContain('aria-label="上一张"')
    expect(component).toContain('aria-label="下一张"')
    expect(component).toContain('aria-label="放大"')
  })
})
