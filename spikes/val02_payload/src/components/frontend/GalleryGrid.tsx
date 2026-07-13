'use client'

import React from 'react'
import { useEffect, useState } from 'react'

import type { GalleryImage } from '@/lib/gallery'

export function GalleryGrid({ images }: { images: GalleryImage[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const active = activeIndex === null ? null : images[activeIndex]

  const close = () => {
    setActiveIndex(null)
    setZoom(1)
  }

  const move = (delta: -1 | 1) => {
    if (activeIndex === null || images.length === 0) return
    setActiveIndex((activeIndex + delta + images.length) % images.length)
    setZoom(1)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeIndex === null) return
      if (event.key === 'Escape') close()
      if (event.key === 'ArrowLeft') move(-1)
      if (event.key === 'ArrowRight') move(1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!images.length) return <p className="empty-gallery">暂无可公开主图。</p>

  return (
    <>
      <div className="gallery-grid">
        {images.map((image, index) => (
          <button
            aria-label={`放大 ${image.alt}`}
            className="gallery-card"
            key={image.id}
            onClick={() => setActiveIndex(index)}
            type="button"
          >
            {/* Plain img preserves local Payload URLs and intrinsic dimensions. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={image.alt} height={image.height} src={image.url} width={image.width} />
            {image.isGroup ? <span className="group-badge">多人</span> : null}
          </button>
        ))}
      </div>

      {active ? (
        <div aria-label="图片查看器" aria-modal="true" className="lightbox" role="dialog">
          <div className="lightbox-controls">
            <button aria-label="关闭" onClick={close} type="button">
              关闭
            </button>
            <button aria-label="缩小" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>
              −
            </button>
            <button aria-label="放大" onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>
              ＋
            </button>
          </div>
          <button aria-label="上一张" className="lightbox-previous" onClick={() => move(-1)}>
            ‹
          </button>
          <div className="lightbox-image-shell">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={active.alt}
              height={active.height}
              src={active.url}
              style={{ transform: `scale(${zoom})` }}
              width={active.width}
            />
          </div>
          <button aria-label="下一张" className="lightbox-next" onClick={() => move(1)}>
            ›
          </button>
        </div>
      ) : null}
    </>
  )
}
