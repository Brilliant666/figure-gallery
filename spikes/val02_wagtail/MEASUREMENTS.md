# Wagtail prototype measurements

Measured on 2026-07-14 (Windows, Python 3.10.9) against the final shared
synthetic fixture. These are small-sample comparison observations, not load-test
or production capacity claims.

## Commands

- Cold process command: `python manage.py runserver 127.0.0.1:18081 --noreload`
- Database initialization: `python manage.py migrate --noinput`
- Seed: `python manage.py seed_synthetic --reset`
- Tests: `python manage.py test gallery.tests -v 1`
- Static build equivalent: `python manage.py collectstatic --noinput --clear`

## Observations

| Measurement | Observed |
| --- | ---: |
| New runserver process to first HTTP 200 | 2.548 s |
| Required application processes | 1 |
| Home response, 5 samples | 31.761, 1.899, 1.890, 2.044, 1.968 ms |
| Unique-alias search redirect, 5 samples | 5.373, 4.520, 4.496, 4.806, 8.276 ms |
| Character gallery, 5 samples | 41.369, 11.795, 9.718, 10.489, 10.601 ms |
| Shared fixture rows | 2 works, 4 characters, 3 manufacturers, 5 prototypes, 8 versions, 9 sources (5 formal + 4 candidate), 4 candidates, 11 images |
| Custom implementation lines | 2,752 across 21 Python/HTML/CSS/JS files; excludes tests, migrations and generated files |
| Test lines | 1,145 across 4 test modules; 46 tests executed |
| Admin UI customization lines | 221 across `forms.py`, `wagtail_hooks.py`, and the custom review template |
| Project migration files | 2 |
| Direct dependencies | 3 |
| Fully pinned installed distributions | 40 |

The first home and gallery samples include first-request/template/rendition cache
effects; later samples are warm-process observations. The cold-start probe first
verified port 18081 was unused, verified the listener command line belonged to
this runserver process, and terminated that exact process afterward.

## Local and minimal cloud topology

- Local minimum: one Django/Wagtail process, SQLite file, and filesystem media.
- Comparison-only cloud minimum: one persistent WSGI/ASGI service, a supported
  relational database, S3-compatible object storage, and static asset serving.
  SQLite is not proposed as a multi-instance production database.
- Image processing: originals are stored once; Wagtail renditions are generated
  through the Storage API and can be deleted/rebuilt.
- Python candidate integration: same runtime/language, one candidate-only local
  HTTP endpoint, no Node sidecar.

## Known system-check signal

`manage.py check` and migration commands complete with two unsilenced
`treebeard.E001` warnings. Wagtail 7.4.2 resolves django-treebeard 5.3.0, whose
check warns that Wagtail-generated managers would be incompatible with a future
Treebeard 6. The installed version is still below 6; migrations, seed,
revision/workflow, rendition, admin and frontend tests pass. This is an upgrade
risk to monitor, not a hidden pass.

The final generated acceptance result is 29 pass, 0 fail, and 1 not run across
30 contract items. AC-29 remains not run because real Chrome lightbox navigation
could not be controlled in this environment; its static DOM/JavaScript
substitute passed but is not reported as browser interaction.
