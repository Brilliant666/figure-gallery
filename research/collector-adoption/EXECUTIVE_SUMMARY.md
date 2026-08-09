# Collector adoption review — executive summary

## Decision

Choose **B. SIMPLIFY AND CONVERGE**.

The collector has proved that high-recall acquisition is possible: the frozen
Rem dataset contains 285 **collector-classified pose-eligible** catalog records,
284 with an image URL and 171 with at least two image URLs. The old
architecture's central product idea is
still right—one gallery card should represent one `FigurePrototype`, not one
retailer page—but implementation was sequenced around governance, CRUD,
rollback and production infrastructure before the real data boundary was
known.

The shortest path is therefore neither to resume the old roadmap unchanged nor
to replace the product with the collector. Keep the fast, source-specific
collectors outside the product; introduce the minimum provenance and catalog
layers; group the existing catalog records into probable prototypes; then reuse
the proven personal-gallery experience.

## What the 285 records prove

- The persisted file contains 285 unique, collector-retained catalog records.
  Eligibility was not manually re-audited for all 285; a fixed 129-card Chrome
  sample found at least one low-value ArtScale bust leak. The run report says
  the broad set was 330 and 45 were excluded; only the 285 retained rows remain
  available for row-by-row verification.
- 186 records (65.3%) are Prize under the collector's rules. Prize is already
  the dominant body of the Rem pose library, not merely a supplement to scale
  figures.
- 284 records have at least one image; 171 have two or more, 111 have four or
  more, and 69 have eight or more.
- Solaris appears in 280 retained records and supplies the coverage baseline.
  Good Smile appears in 32 records, with 29 overlapping Solaris and three
  marginal records. Japan Figure appears in 19, with 17 overlapping Solaris
  and two marginal records.
- 45 records combine more than one source. The current flattening loses exact
  field and image provenance; some Good Smile-labelled rows contain Solaris
  product IDs, prices or timestamps. This is the clearest adoption blocker.
- A JSON row is closest to a normalized **CatalogItem**, not automatically a
  `FigurePrototype`, `FigureVersion` or pose.

The prototype estimate is a research estimate, not a merge result. A title
heuristic finds many renewal, re-release, recolor, online-crane and Last One
families. The manual visual sample is recorded in
[`POSE_DUPLICATION_SAMPLE.md`](POSE_DUPLICATION_SAMPLE.md); it supports an
expected order of magnitude of roughly **235 independent prototype cards**, with
a deliberately wide **220–252** interval until all 285 items are grouped.

## What was right, and what was premature

Correct ideas to preserve:

- `Character` and stable product-owned UUIDs;
- `FigurePrototype` as the public gallery-card identity;
- multiple characters per prototype;
- source data never overwriting formal choices automatically;
- an owner-selected cover and all useful images on the detail page;
- Payload CMS + Next.js, PostgreSQL and S3 as the accepted eventual production
  baseline;
- the Hpoi no-automation boundary.

Premature or oversized for the present evidence:

- treating a complete Candidate/Review workflow as the only path into a
  one-owner private gallery;
- implementing 30 catalog command variants before validating catalog-to-
  prototype grouping;
- full dependency-aware merge/split/undo and enterprise-style `OperationLog`;
- making PostgreSQL, S3, Payload Admin, backup/restore and the full security
  matrix prerequisites for learning from the 285 records.

These are delayed, not disproved. The maximum value now comes from preserving
source evidence and resolving product-versus-prototype identity.

## Minimum converged product

Four business entities are enough for the next evidence-building phase:

1. `Character`
2. `SourceRecord`
3. `CatalogItem`
4. `FigurePrototype`

`ImageRef` is initially a value object attached to source/catalog records; it
does not need its own formal collection yet. `FigureVersion`, `Work`, a full
Manufacturer lifecycle, and durable media infrastructure remain planned but
must not block the grouping benchmark.

The supply chain becomes:

```text
source-specific collectors
  -> immutable source observations
  -> normalized catalog items
  -> reversible prototype assignments
  -> personal character gallery
```

The collector stays permissive and fast. The product owns stable identity,
normalization, grouping, cover selection and display. No collector is required
to implement the Payload domain model.

## Product experience to keep

Keep character routes and search, one prototype per card, a manually preferred
cover, a detail page with all reference images, 4/3/2 responsive columns,
aspect-ratio preservation, lazy loading, keyboard lightbox navigation, zoom,
type/manufacturer/year filters, exclusion/restore, notes and local image
resilience. Do not build a complex Admin UI until this workflow has been used
on the grouped Rem dataset.

## Draft PR recommendations

- **PR #18: do not merge; close or abandon the fixed Head.** Preserve only the
  source-neutral lessons—candidate states, coverage metrics, CatalogItem is not
  Prototype, and the Hpoi guard. The Hpoi-index implementation produced no
  collected official records and should not remain the mainline discovery
  strategy.
- **PR #19: revise before any merge.** Preserve the Discovery/Identity/Media
  split, source/version/prototype separation, global incremental ingestion and
  permission-first gates. Replace its proposed hub/connector ordering with the
  285-record evidence. Technical access still does not establish permission to
  persist or redistribute any source.

Neither PR was modified or merged by this review.

## Next action

Perform one bounded offline grouping benchmark over the frozen 285 records:
emit versioned `SourceRecord` and `CatalogItem` snapshots, assign each item to a
provisional `FigurePrototype` in a reversible mapping manifest, record
uncertain cases, and select candidate covers. Do not add another source or
start Payload import until this benchmark establishes the true prototype count
and manual effort.

## Short-term success measures

Measure outcomes, not framework surface area:

1. collector-classified pose-eligible catalog coverage plus sampled leakage;
2. probable unique-prototype coverage;
3. catalog-item duplication/grouping rate;
4. items with at least one usable image;
5. prototypes with multi-angle reference media;
6. refresh latency for newly observed catalog items;
7. manual decisions per 100 incoming catalog items;
8. marginal accepted prototypes per connector hour/request budget.
