import Link from 'next/link'
import { redirect } from 'next/navigation'

import { resolveCharacterMatches, searchCharacters } from '@/lib/gallery'

export const dynamic = 'force-dynamic'

export default async function SearchResults({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const query = (await searchParams).q?.trim() ?? ''
  const matches = await searchCharacters(query)
  const resolution = resolveCharacterMatches(matches)
  if (resolution.kind === 'unique') redirect(resolution.target)

  return (
    <main className="result-page">
      <Link href="/">← 返回搜索</Link>
      <h1>{resolution.kind === 'disambiguation' ? '请选择作品' : '没有找到角色'}</h1>
      {resolution.kind === 'disambiguation' ? (
        <ul className="disambiguation-list">
          {resolution.matches.map((match) => (
            <li key={match.id}>
              <Link href={`/characters/${match.id}`}>
                <strong>{match.displayName}</strong>
                <span>{match.workName}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>没有与“{query}”匹配的角色。</p>
      )}
    </main>
  )
}
