# PR #18 and PR #19 reassessment

This is a read-only decision record. It does not change either pull request.
Both were re-read at their fixed Heads on 2026-08-10.

## PR #18

- PR: `#18 MVP-05: use Hpoi index discovery to expand character coverage`
- Head: `fc98738f9858ad123fd9f8ab6167855f9c7f9782`
- Observed state: open Draft against `main`
- Recommendation: **do not merge; close or abandon this Head**

### Retain as source-neutral knowledge

- `Candidate` or staging states rather than direct formal writes;
- explicit coverage and marginal-yield metrics;
- the distinction between a discovered product and a prototype card;
- network guards and the rule that Hpoi remains manual-only without written
  permission.

### Simplify or supersede

- Keep the idea of coverage gaps, but measure accepted marginal prototypes per
  connector cost rather than search-result counts.
- Keep candidate review only for exceptions; do not require field-by-field
  work items for every high-confidence catalog observation.

### Abandon from the mainline

The primary two-character pass used 83 Search requests (55 index plus 28
official-resolution requests), with an estimated upper bound of 166 credits.
Across the full task—including idempotency, post-fix calibration, rate-limit
observation and diagnostics—the evidence records 207 Search requests and an
estimated 414 credits. Rem produced 35 index candidates, 14 in-scope and 12
remaining new targets, but zero resolved official records and zero collected
additions. This should not be the principal discovery route after a catalog
path produced 285 retained records. No Hpoi code, configuration or UI from this
Head should be cherry-picked into the current direction.

## PR #19

- PR: `#19 RESEARCH: evaluate catalog hubs for figure database ingestion`
- Head: `c50ad02bd1adc5ba9a71e3651272b7c1fc023083`
- Observed state: open Draft against `main`
- Recommendation: **revise before any merge; do not merge unchanged**

### Conclusions that remain valid

- Discovery, Identity and Media are separate capabilities.
- SourceRecord, catalog/version and prototype identities must be separated.
- Global/cursor-based incremental ingestion scales better than repeating
  character searches where a lawful catalog feed exists.
- Technical reachability is not permission to persist, transform or
  redistribute source data or images.
- A connector should be ranked by marginal in-scope prototypes and maintenance
  cost, not raw listing count.

### Conclusions changed by the 285-record evidence

- A high-yield catalog-style path is no longer hypothetical: Solaris membership
  covers 280 of the 285 retained records in the frozen dataset.
- The proposed “three hubs plus five-to-eight maker gaps” topology is not yet
  justified. Measure the remaining prototype and media gaps after grouping
  Solaris-derived records before commissioning many connectors.
- Direct manufacturer connectors are primarily media/metadata enrichment and
  true-gap tools, not the default discovery strategy. Good Smile's 32 retained
  memberships add only three records over the Solaris baseline but contribute
  the densest official-image evidence.
- Japan Figure contributes two marginal retained records from 19 and is useful
  for gap discovery, not broad media enrichment.
- The next named connector should not be chosen from desk research alone. The
  prototype grouping benchmark must expose the actual manufacturer/source gap.

### Permission status is not upgraded

The external collector's technical success does not establish that Solaris,
Good Smile or Japan Figure is permission-cleared for a persistent or public
production supply chain. The statement “production-ready permission-cleared
hubs = 0” therefore remains conservative until source-specific written terms or
permission are documented. This review neither accessed those sites nor
authorizes automated production ingestion.

## Final disposition

| Pull request | Disposition | Reusable output |
| --- | --- | --- |
| #18 | Close/abandon fixed Head; do not merge | source-neutral staging, coverage metrics, network guard |
| #19 | Rewrite with 285-record evidence before considering merge | layer separation, permission gates, global incremental principle |

Neither PR was merged or modified.
