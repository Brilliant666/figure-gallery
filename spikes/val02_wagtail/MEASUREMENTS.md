# Wagtail VAL-02B measurements

Measured on 2026-07-14 on Windows/Python 3.10.9 against the shared synthetic
fixture. These are comparison observations, not production capacity claims.
VAL-02 timing numbers were not carried forward.

## Executed commands

- Fresh and repeated migration: `python manage.py migrate --noinput`
- Repeated seed: `python manage.py seed_synthetic --reset`
- Regression/gates: `python manage.py test gallery.tests -v 1`
- Static collection with `DJANGO_DEBUG=false`:
  `python manage.py collectstatic --noinput --clear`
- Shared result: `python manage.py generate_val02b_acceptance`

## Current code and gate counts

| Measurement | Observed |
| --- | ---: |
| Custom implementation lines | 5,263 |
| Test lines | 2,476 across 5 test modules |
| Admin UI customization lines | 331 |
| Candidate endpoint/service lines | 1,280 |
| Django tests | 70/70 passed |
| Project migration files | 3 |
| Direct dependencies | 4 |
| Required local application processes | 1 |
| Export relational tables | 13 JSON lists / 12 non-empty CSV tables |
| VAL-02B with Chrome report | 17 pass / 0 fail / 0 not_run / 13 environment_blocked |

The implementation count excludes tests, migrations, `__init__.py`, runtime
files and generated acceptance JSON. The Admin count covers `forms.py`,
`wagtail_hooks.py` and both custom Admin templates. Endpoint/service count
covers `views.py`, `candidate_service.py`, `candidate_media.py` and
`client_identity.py`.

## Timing status

Real Chrome completed the candidate review in 5,808.42 ms with 6 clicks and 8
main-frame navigations. The expanded gallery flow took 5,314.41 ms with 15
clicks, one keyboard action and 13 navigations; it exercised adult visibility,
page 2, 4/3/2 columns and current-page lightbox boundaries. A real loopback
`LiveServerTestCase` also exercised the shared Python client's multipart upload
and idempotent retry, but its test-run duration is not treated as a standalone
file-import benchmark.

PostgreSQL, S3-compatible storage, backup/restore and clean production-form
deployment were environment-blocked. Consequently no cold production start,
PostgreSQL restore time, S3 operation time or non-production deployment step
count is claimed.

## Treebeard signal

Two unsilenced `treebeard.E001` warnings remain visible. Wagtail 7.4.2's
upstream package metadata requires `django-treebeard>=4.8,<6.0`; the spike pins
5.3.0 exactly, fails closed on another installed version, and tests Page and
Collection tree mutations. This is an explicit upgrade gate, not a declaration
that the warning is harmless.
