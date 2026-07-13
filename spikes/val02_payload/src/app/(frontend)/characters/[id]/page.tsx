import Link from 'next/link'
import { notFound } from 'next/navigation'

import { GalleryGrid } from '@/components/frontend/GalleryGrid'
import { getCharacterGallery } from '@/lib/gallery'

export const dynamic = 'force-dynamic'

export default async function CharacterGalleryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { id } = await params
  const page = Number((await searchParams).page ?? '1')
  let gallery: Awaited<ReturnType<typeof getCharacterGallery>>
  try {
    gallery = await getCharacterGallery(id, Number.isFinite(page) ? page : 1)
  } catch {
    notFound()
  }
  return (
    <main className="gallery-page">
      <Link href="/">← 返回搜索</Link>
      <h1>{gallery.characterName}</h1>
      <GalleryGrid images={gallery.images} />
      <nav aria-label="图库分页" className="pagination">
        {gallery.page > 1 ? (
          <Link href={`/characters/${id}?page=${gallery.page - 1}`}>上一页</Link>
        ) : (
          <span />
        )}
        <span>
          {gallery.page} / {Math.max(gallery.totalPages, 1)}
        </span>
        {gallery.page < gallery.totalPages ? (
          <Link href={`/characters/${id}?page=${gallery.page + 1}`}>下一页</Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  )
}
