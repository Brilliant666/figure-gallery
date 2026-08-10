# Character Figure Collector MVP

This disposable local tool tests whether the catalog pipeline can be driven by a small character profile instead of character-specific code. It supports exactly two profiles: `rem` and `cheshire`. It does not belong to `apps/web`, and its runtime output is written below the repository-level ignored `.local/` directory.

The shared pipeline reads three bounded public catalog sources:

- Solaris Japan collection JSON (wide baseline);
- Good Smile current reviewed product seeds and, for `sync`, the legacy public search;
- one Japan Figure UCP catalog query, exhausted through its explicit cursor pagination.

The fetcher checks `robots.txt` before source requests, fails closed when that policy cannot be checked, delays requests per host, validates every redirect, and stops on 401, 403, or 429. Hpoi and all unlisted hosts are hard-denied. There is no Firecrawl, proxy, browser automation, login, cookie, source guessing, or fourth connector.

## Commands

```powershell
cd tools/character-figure-collector-mvp
npm ci
npm test
npm run sync -- --character cheshire
npm run refresh -- --character cheshire
```

Optional runtime controls:

```powershell
$env:CHARACTER_FIGURE_COLLECTOR_ROOT = 'C:\path\to\private-runtime'
$env:CHARACTER_FIGURE_REQUEST_DELAY_MS = '1500'
```

The default runtime location is:

```text
.local/character-figure-collector/<character>/
├── catalog-wide.json
├── catalog-pose-eligible.json
├── grouping-input.json
├── grouping-results.json
├── review-template.json
├── projection-input.json
├── baseline-comparison-input.json
├── state.json
└── runs/<run-id>/summary.json
```

`catalog-wide.json` is the retained catalog after character/work discrimination. `catalog-pose-eligible.json` applies the shared normal-proportion pose-reference contract. `grouping-input.json` is a small framework-independent handoff to the shared prototype projection; this collector does not decide visual REVIEW pairs and does not write formal application data.

`grouping-results.json` applies the same precision-first text rules to emit `AUTO_MERGE`, `REVIEW`, and explicit `KEEP_SEPARATE` relations with a complete-link safety check. `review-template.json` contains only REVIEW pairs for optional manual image assistance. `projection-input.json` adapts the collector schema to the stable figures-like contract consumed by the generic projection CLI, so projection code never imports collector internals.

`baseline-comparison-input.json` exposes deterministic title/manufacturer keys plus source identities and URLs for comparing the new catalog with a previously reviewed local baseline without importing either runtime schema into the other tool.

`sync` includes the bounded Good Smile legacy backfill. `refresh` omits that historical search and checks the normal sources. Both merge with existing runtime records, preserve source provenance, and report unchanged/changed/new counts using the versioned business digest rather than volatile observation timestamps or response ordering. Runtime files contain no credentials and must never be committed.
