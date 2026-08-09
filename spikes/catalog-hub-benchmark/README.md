# Catalog Hub benchmark spike

This directory contains a disposable, standard-library-only calculator for
DISCOVERY-RESEARCH-01R. It does not fetch any website and is not imported by the
formal application or the personal gallery tool.

The checked-in observation file contains only small aggregate research facts.
It contains no HTML, image, credential, Cookie, Authorization header, or local
runtime data.

Run the offline checks and regenerate the evidence file:

```powershell
python -m unittest discover -s spikes/catalog-hub-benchmark/tests -v
python spikes/catalog-hub-benchmark/benchmark.py `
  --input spikes/catalog-hub-benchmark/observations.json `
  --audit research/evidence/catalog-hub-discovery/goodsmile-audit.json `
  --output research/evidence/catalog-hub-discovery/results.json
```

The calculator derives the Good Smile coverage from the 41-row audit, validates
the per-image sample against its aggregate, derives ratios, and keeps blocked
benchmark fields explicitly null instead of inventing results.
