# VAL-02 / VAL-02B Wagtail proof of concept

This is a disposable, offline comparison spike. It is not the formal product
and does not by itself select the final stack. Every fixture and generated PNG
is synthetic; runtime databases, media, exports, credentials, screenshots and
browser artifacts stay under `%TEMP%` and are not committed.

## Runtime and boundaries

- Python 3.10.9, Django 5.2.16, Wagtail 7.4.2,
  django-storages 1.14.6 and django-treebeard 5.3.0.
- SQLite is the only database actually exercised in this spike environment.
- `gallery.network_guard` blocks `hpoi.net` and all subdomains before DNS or
  transport. No data-source fetcher exists here.
- Candidate ingress exposes only `candidate_upsert` and
  `candidate_media_upload`. It has no formal Work/Character/Manufacturer/
  FigurePrototype/FigureVersion/main-image mutation method.
- Each candidate client has an independent ID and bearer secret. Only a SHA-256
  digest is stored; credentials are attributable, revocable and audited.
- Candidate ownership is checked server-side for metadata and multipart media.
  Client A cannot claim or update client B's candidate.
- Candidate PNG/JPEG uploads are limited to 64 KiB, validated from bytes,
  checked against declared MIME/size/dimensions/SHA-256/aHash, content-addressed
  and deduplicated. Upload receipts bind each client idempotency key to a digest.
  Failed writes roll back database rows and remove newly written storage files.
- Wagtail Images stores candidate originals in a dedicated collection and
  creates `fill-64x64` and `max-320x320` renditions. Only an audited staff
  service can attach a reviewed candidate image and select it as formal main.
- `ReviewWorkItem` contains the candidate, allowed formal targets, reviewer,
  state, optimistic lock version, timestamps and decision reason. Completed
  work cannot mutate until an explicit audited reopen.
- Merge/split logs have stable UUID operation IDs, scopes and versions.
  `undo_operation` takes an explicit ID; there is no global-latest undo API.
  Active dependent or overlapping later operations block unsafe undo.
- Generic Wagtail snippet forms are read only, even for a superuser. Candidate
  review and the small domain-operation console call transactional services and
  emit `OperationLog`; they are verification UI, not product UI.

The loopback check remains defense in depth for the disposable local client,
but authorization does not depend on loopback: identity, owner and operation
checks are performed by the service for every accepted candidate write.

## Local setup

PowerShell commands from this directory:

```powershell
python -m venv .venv
& .venv/Scripts/python.exe -m pip install -r requirements.lock
$env:VAL02_WAGTAIL_RUNTIME_DIR = Join-Path $env:TEMP "figure-gallery-val02b-wagtail"
& .venv/Scripts/python.exe manage.py migrate --noinput
& .venv/Scripts/python.exe manage.py seed_synthetic --reset
& .venv/Scripts/python.exe manage.py runserver 127.0.0.1:8000 --noreload
```

The seed reads `../val02_contract/fixtures/domain_fixture.json`. It generates
all PNG bytes at runtime and creates no usable password or committed token.

## TEMP-only browser scenario

The provisioning command consumes two runtime secrets and prints only a JSON
manifest containing IDs, username and paths. Neither secret is printed or
stored as plaintext:

```powershell
$env:VAL02B_ADMIN_PASSWORD = '<runtime-random-password>'
$env:VAL02B_CANDIDATE_TOKEN = '<runtime-random-token>'
& .venv/Scripts/python.exe manage.py provision_val02b_browser
```

The manifest exposes `/admin/login/` and
`/admin/candidate-review/<candidate-id>/`. Stable browser selectors include
`candidate-review`, `candidate-images`, `review-work-item`, `review-form`,
`apply-review`, `operation-log-results` and `operation-log-count`.
The minimal formal command console is `/admin/domain-operations/` with
`domain-operations`, `domain-operation-form` and `apply-domain-operation`.

The shared Playwright harness uses local Chrome and writes its JSON report only
to `%TEMP%/figure-gallery-val02b-playwright/` by default. Screenshots and videos
must not be added to Git.

## Candidate client

The shared client reads these runtime variables:

```powershell
$env:VAL02_WAGTAIL_CANDIDATE_CLIENT_ID = 'runtime-client-id'
$env:VAL02_WAGTAIL_CANDIDATE_TOKEN = '<runtime-token-shown-once>'
$env:VAL02_WAGTAIL_CANDIDATE_ENDPOINT = 'http://127.0.0.1:8000/api/val02/candidates/upsert/'
$env:VAL02_WAGTAIL_CANDIDATE_UPLOAD_ENDPOINT = 'http://127.0.0.1:8000/api/val02b/candidates/media/upload/'
```

Client identities are created through `create_candidate_client`; plaintext is
returned once to the runtime caller. The shared Python client's public surface
contains candidate upsert and synthetic candidate-media upload only.

## Checks and machine results

```powershell
& .venv/Scripts/python.exe manage.py check
& .venv/Scripts/python.exe manage.py makemigrations --check --dry-run
& .venv/Scripts/python.exe manage.py test gallery.tests -v 2
& .venv/Scripts/python.exe manage.py collectstatic --noinput
& .venv/Scripts/python.exe manage.py generate_acceptance
& .venv/Scripts/python.exe manage.py generate_val02b_acceptance `
  --browser-results "$env:TEMP/figure-gallery-val02b-playwright/playwright-results.json"
```

`generate_val02b_acceptance` reruns the real Django suite and derives BG-05
through BG-16 and BG-30 from exact per-test outcomes. It consumes standard
Playwright JSON for BG-01 through BG-04. If no browser report is supplied those
items are `not_run`; static checks are never substituted for browser evidence.
BG-17 through BG-29 are `environment_blocked` in this host because Docker's
engine, PostgreSQL and local S3-compatible storage were unavailable. Local
SQLite, filesystem storage and WSGI health checks are supplemental evidence,
not replacements for those gates.

## Treebeard decision gate

Wagtail 7.4.2's installed upstream package metadata declares
`django-treebeard>=4.8,<6.0`. This spike pins the exact tested version 5.3.0 in
both direct and lock requirements. `GalleryConfig.ready()` refuses any other
installed version, forcing the manager/workflow/migration gate to be rerun on
upgrade. Automated tests exercise both Page and Collection tree mutations and
assert that the two `treebeard.E001` warnings remain visible; no system check is
silenced.

This is the allowed “exact compatible pin plus upgrade gate” conclusion, not a
claim that the warnings have no effect. Treebeard 6 remains unsupported until
Wagtail's generated managers satisfy its contract and all compatibility tests
are rerun.

## Export and storage

JSON and relational CSV exports contain relationship IDs, ReviewWorkItem,
OperationLog UUID/scope, settings, storage keys, SHA-256 and aHash. They contain
no media binary, plaintext token or token digest. Exports are written to TEMP:

```powershell
& .venv/Scripts/python.exe manage.py export_gallery --format json --output "$env:TEMP/val02b-wagtail.json"
& .venv/Scripts/python.exe manage.py export_gallery --format csv --output "$env:TEMP/val02b-wagtail-csv"
```

The S3 storage adapter remains configuration-only in this environment. No S3,
PostgreSQL, backup/restore or clean non-production deployment gate is claimed
as passed.

## Scope stop

This directory remains under `spikes/`. It has not been moved into a formal
application, deployed, connected to Hpoi or populated with real figure images.
