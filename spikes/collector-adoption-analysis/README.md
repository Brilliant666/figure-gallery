# Collector adoption analysis

This disposable, standard-library-only script audits a local
`rem-figure-collector/figures.json` without changing that collector or making
network requests.

```powershell
python analyze.py --figures "<path-to-rem-figure-collector>\figures.json"
```

The JSON output contains aggregate counts only. It deliberately reports when
the merged file can no longer attribute a field or an image to one source.

The type buckets are review heuristics, not normalized catalog truth. Prize is
matched first, followed by scale evidence, POP UP PARADE, an explicit
`Non-Scale Figure` category, and a residual
`other_collector_retained_unclassified` bucket.
Limited/exclusive is reported separately because it is a release or channel
modifier rather than a figure type.
