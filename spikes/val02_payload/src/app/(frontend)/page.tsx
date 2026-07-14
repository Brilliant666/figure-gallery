export default function SearchHome() {
  return (
    <main className="search-home">
      <div className="search-shell">
        <h1>Figure Gallery</h1>
        <form action="/search" className="search-form">
          <label className="sr-only" htmlFor="character-search">
            角色名称
          </label>
          <input
            autoComplete="off"
            id="character-search"
            name="q"
            placeholder="搜索角色"
            required
            type="search"
          />
          <button type="submit">搜索</button>
        </form>
      </div>
    </main>
  )
}
