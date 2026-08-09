# Next phases

Only four phases are recommended. The sequence deliberately pauses further
formal product implementation until the data model has been tested against the
existing 285 records.

## Phase A — Freeze an auditable supply snapshot

**Goal:** retain collector speed while restoring provenance.

- version a source-neutral export contract;
- emit separate SourceRecords and normalized CatalogItems;
- preserve excluded observations and reasons in run summaries;
- attach field/image origin to the source observation;
- keep the current 285-row file as an immutable benchmark;
- add only lightweight schema, idempotency and secret/network checks.

**Stop when:** the same frozen input deterministically emits the same source and
catalog identities, and no field or image requires guessing its origin.

## Phase B — Group CatalogItems into probable prototypes

**Goal:** learn the real homepage-card count and manual cost.

- review all 285 CatalogItems, starting with the 30 high-likelihood variant
  families from this study;
- assign a stable provisional prototype UUID or `needs_review`;
- record A–F relationship class, confidence and reason;
- keep assignments reversible and non-destructive;
- select a preferred cover and reject irrelevant images;
- report catalog-item duplication rate and uncertainty.

**Stop when:** every CatalogItem is assigned or explicitly unresolved, the
prototype count is reproducible, and corrections do not rewrite source data.

## Phase C — Ship the useful character-gallery projection

**Goal:** turn the grouped dataset into the owner-facing Rem reference library.

- one prototype per card;
- character route/search and type/manufacturer/era filters;
- preferred cover plus a detail page with all eligible images;
- 4/3/2 responsive grid, aspect-ratio preservation, lazy loading;
- keyboard lightbox, zoom, exclusion/restore and notes;
- incremental refresh that does not overwrite grouping or preferences.

**Stop when:** the owner can browse, filter and inspect the grouped Rem library,
and a refresh adds new catalog observations without duplicating cards.

## Phase D — Formalize only the proven boundary

**Goal:** move the stable model into the accepted production stack when its
cost is justified.

- implement the proven Character/SourceRecord/CatalogItem/FigurePrototype
  boundary in Payload + PostgreSQL;
- move durable media to S3-compatible storage with manifests;
- add an exception-oriented Admin workflow;
- re-enable the relevant transactional, security, backup/restore and browser
  gates;
- retain adapters as external supply-chain components.

**Stop when:** production migration, identity, permissions, media integrity,
backup/restore and the gallery projection pass against the frozen benchmark.

## Single next action

Run **Phase B's bounded offline grouping benchmark** on the frozen 285 records,
with the minimal Phase A provenance snapshot needed to avoid further flattening.
Do not add another source, a third character or a Payload import first.

## Short-term success metrics

| Metric | Why it matters |
| --- | --- |
| Pose-eligible catalog coverage | measures useful acquisition, not raw noise |
| Unique probable-prototype coverage | approximates actual gallery value |
| Catalog-item duplication/grouping rate | quantifies version and retailer inflation |
| Items with a usable image | protects minimum gallery usefulness |
| Prototypes with multi-angle media | measures pose-reference depth |
| New-item refresh latency | checks that adoption does not slow collection |
| Manual decisions per 100 items | keeps review cost visible |
| Marginal accepted prototypes per connector hour/request | prevents low-yield connector expansion |
