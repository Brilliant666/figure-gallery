# VAL-02 Wagtail proof of concept

This directory is a disposable, offline comparison prototype. It is not a
production project and does not choose the final stack. It uses only the shared
synthetic fixture; seed images are generated in the runtime media directory and
are never committed.

## Verified runtime

- Python 3.10.9
- Django 5.2.16
- Wagtail 7.4.2
- django-storages 1.14.6 with the S3 extra
- SQLite for local data
- one Python process for the local application

The versions above were stable formal releases in the task environment on
2026-07-14. Direct versions are in `requirements.txt`; every installed
transitive dependency is pinned in `requirements.lock`. The local virtual
environment is `.venv/` and is ignored.

## Safety boundaries

- `gallery.network_guard` blocks `hpoi.net` and every subdomain before DNS or
  `requests` transport. The prototype has no outbound data-source code.
- Candidate HTTP writes expose one operation: `candidate_upsert`. It can only
  upsert `SourceRecord`, `CandidateRecord`, and candidate media metadata. The
  handler fails closed unless the actual socket peer address is loopback and
  does not trust forwarded-address headers.
- Candidate image objects reject the out-of-contract `image` and `image_id`
  fields, so the candidate token cannot guess and attach an existing Wagtail
  Image. If an upsert matches an image already attached to a formal prototype
  or selected as main, the changed observation is audited while every stored
  media/provenance field and the formal main-image reference are preserved.
- A formal `SourceRecord` with no existing candidate cannot be claimed through
  candidate ingress. A reviewed candidate whose source is now attached to a
  prototype can still be re-collected, preserving the update-pending flow.
- The candidate API cannot create formal characters, manufacturers, prototypes
  or versions, cannot attach a candidate to formal data, and cannot select or
  replace a main image.
- Formal review, main-image selection, merge, split and undo require an
  authenticated staff user and execute inside Django transactions.
- Manufacturer draft creation/status changes and the adult/page-size/public
  switches likewise use staff-only transactional services with `OperationLog`.
  This spike does not add Wagtail UI controls for those services.
- Seed creates `fixture-admin` with an unusable password; no administrator
  password, API token, session, cookie or fixed Django secret is committed.
- The Django secret is read from the environment or generated in memory for the
  current process. The candidate token must exist in the runtime environment.
- Database, generated media, renditions, static build output and exports default
  to `%TEMP%/figure-gallery-val02-wagtail`, not the repository.

## What Wagtail actually provides

- Wagtail Images stores original synthetic PNGs and creates rebuildable
  renditions through Django's Storage API.
- `FigurePrototype` is a non-Page model using `RevisionMixin`,
  `DraftStateMixin`, and `WorkflowMixin`. Automated tests save, deserialize and
  publish a revision and start a real Wagtail workflow for this model.
- `SnippetViewSet` supplies listings for candidate records and figure
  prototypes. A custom Wagtail admin review page displays candidate fields and
  multiple images and exposes explicit create/attach/field decision/main-image/
  defer/ignore actions.

Wagtail does not provide the relationship-heavy domain model, candidate/formal
security boundary, cross-record merge/split/undo, reversible operation log,
single-field decision semantics, or open relational export. Those parts remain
custom code. The admin shell and image/revision infrastructure save work, but a
high-frequency candidate workbench still needs a purpose-built view.

The disposable undo service always targets the globally latest non-undone
merge or split. It has no per-reviewer/per-work-item scope and was not tested
under concurrent reviewers. Wagtail Admin also has no merge/split/undo,
manufacturer-lifecycle, or system-setting controls in this spike; those paths
exist only as tested domain services.

`decide_candidate_field` lets a trusted staff caller supply an explicit target
prototype rather than binding the write to the candidate's previous target.
That flexibility is useful for this review spike, but a formal authorization
model would need to constrain targets to the reviewer's current work item.

## Local setup

PowerShell commands from this directory:

```powershell
python -m venv .venv
& .venv/Scripts/python.exe -m pip install -r requirements.lock
$env:VAL02_WAGTAIL_RUNTIME_DIR = Join-Path $env:TEMP "figure-gallery-val02-wagtail"
& .venv/Scripts/python.exe manage.py migrate --noinput
& .venv/Scripts/python.exe manage.py seed_synthetic --reset
& .venv/Scripts/python.exe manage.py runserver 127.0.0.1:8000 --noreload
```

`VAL02_WAGTAIL_RUNTIME_DIR` is the actual runtime-directory setting. If it is
unset, the same `%TEMP%/figure-gallery-val02-wagtail` path is used by default.

The seed reads
`../val02_contract/fixtures/domain_fixture.json`. It generates every PNG at
runtime with Pillow, calculates SHA-256 and a 64-bit average hash, creates
Wagtail images, and selects only fixture-declared manual main images.

No usable admin password is seeded. To explore the UI interactively, create a
temporary local superuser yourself and do not commit its credentials.

## Candidate client

The shared client sends the same envelope used by both prototypes:

```json
{"protocol_version": 1, "operation": "candidate_upsert", "candidate": {}}
```

For a local integration run, generate a temporary token in the current shell,
start the server with the same environment value, then run the shared client:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$env:VAL02_WAGTAIL_CANDIDATE_TOKEN = [Convert]::ToBase64String($bytes)
$rng.Dispose()
python ../val02_contract/python_candidate_client/client.py --adapter wagtail --dry-run
```

The automated suite connects that real shared client to the Django endpoint
through an in-process loopback-equivalent transport. It verifies repeat-run
idempotence, formal-entity isolation, and main-image attack rejection.

The shared client transports metadata only. It does not upload a candidate
file into Wagtail Images, so candidate-file import remains outside the proven
end-to-end path. The token model is also a single prototype-wide ingress key:
there is no per-client owner field, and multiple collectors sharing the key
cannot be attributed or isolated from one another.

Generic Wagtail Snippet forms for candidates, prototypes, manufacturers and
settings are intentionally read-only, including for a superuser. This prevents
default add/edit/delete routes from bypassing `OperationLog`; administrative
writes in this spike go through the audited candidate-review/domain services,
and generic prototype forms do not expose `main_image`.

## Checks and generated acceptance result

```powershell
& .venv/Scripts/python.exe manage.py check
& .venv/Scripts/python.exe manage.py makemigrations --check --dry-run
& .venv/Scripts/python.exe manage.py test gallery.tests -v 2
& .venv/Scripts/python.exe manage.py collectstatic --noinput
& .venv/Scripts/python.exe manage.py generate_acceptance
```

`generate_acceptance` runs the real Django suite in a subprocess and derives
each executable status from its exact per-test outcome. AC-29 is deliberately
recorded as `not_run` with an environment blocker instead of treating a static
JavaScript assertion as browser interaction. It uses the shared
`AcceptanceRecorder`, includes a digest of the actual implementation/test source
files, and never hand-writes `overall` or `pass_count`.

Wagtail 7.4.2 currently resolves django-treebeard 5.3.0. Django system checks
emit `treebeard.E001` warnings about manager compatibility with a future
Treebeard 6; current migrations, seed, revision/workflow and runtime tests still
pass. The warnings are not silenced and must be re-evaluated on upgrade.

## Export and storage

Open exports contain stable database IDs, relationship IDs, source URLs,
storage keys and media hashes, but never image bytes:

```powershell
& .venv/Scripts/python.exe manage.py export_gallery --format json --output "$env:TEMP/val02-wagtail.json"
& .venv/Scripts/python.exe manage.py export_gallery --format csv --output "$env:TEMP/val02-wagtail-csv"
```

See `EXPORT_SCHEMA.md` for field semantics. Local media uses
`FileSystemStorage`. Setting `USE_S3_STORAGE=true` switches the same Storage API
boundary to `storages.backends.s3.S3Storage`; no cloud connection or real
credential was used during VAL-02.

## Read-only frontend

The minimal frontend implements exact canonical-name/alias matching, same-name
work disambiguation, one card per formal prototype, 16-item pagination, a
4/3/2 responsive grid, original-ratio images, adult-image filtering and a
current-page-only lightbox with close, zoom, previous and next. It intentionally
has no detail panel and no download button.

Search, disambiguation, pagination, multi-character visibility, version
deduplication and adult filtering were exercised through Django HTTP rendering.
Responsive CSS, intrinsic width/height and the lightbox DOM/JavaScript contract
were checked statically. Real Chrome click/previous/next/boundary interaction
could not run because the selected Chrome profile had no control extension and
the native host was unavailable; this gap remains visible as AC-29 `not_run`.
