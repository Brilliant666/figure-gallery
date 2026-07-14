# VAL-02B local browser harness

This disposable package is the shared Playwright boundary for the Wagtail and
Payload spikes. It is not a formal application and must only target loopback
prototype servers backed by synthetic data.

## Safety boundary

- Browser output defaults to `%TEMP%/figure-gallery-val02b-playwright`; an
  override inside this repository is rejected.
- Screenshots, video, traces, credentials, generated PNGs, database files and
  complete service logs are never repository outputs.
- The harness blocks `hpoi.net` and every Hpoi subdomain before a request can
  leave the browser. Tests must also retain each prototype's server-side guard.
- Base URLs must be loopback. Runtime-only synthetic administrator credentials
  are read from environment variables; do not create or commit `.env` files.

## Local install and Chrome probe

Use the task-local Node runtime. Do not install Playwright globally. The lock
pins Playwright 1.61.1, TypeScript 5.9.3 and Node types 22.20.1; Node 22+ is
required, so the machine's older global Node runtime is not a substitute.

```powershell
Set-Location spikes/val02b_infra
npm install
npm run typecheck
npm run probe:chrome
```

The default browser is local stable Chrome through `channel="chrome"`. If that
cannot launch, a task-local Playwright Chromium may be installed and selected:

```powershell
npx playwright install chromium
$env:VAL02B_BROWSER_CHANNEL = "chromium"
npm run probe:chrome
```

The probe navigates only to in-memory synthetic HTML and emits one JSON object
to stdout. It does not start either prototype.

## Prototype browser gates

The config defines `wagtail-chrome` and `payload-chrome` projects with defaults
`http://127.0.0.1:8000` and `http://127.0.0.1:3000`. Override them only with
loopback URLs:

```powershell
$env:VAL02B_WAGTAIL_BASE_URL = "http://127.0.0.1:8000"
$env:VAL02B_PAYLOAD_BASE_URL = "http://127.0.0.1:3000"
$env:VAL02B_BROWSER_RESULTS_DIR = "$env:TEMP/figure-gallery-val02b-browser-results"
npm run test:browser:wagtail
npm run test:browser:payload
```

Full tests use runtime-only variables named in `tests/browser-gates.spec.ts`.
Playwright's JSON report is the machine-readable browser result. The test suite
must not print or attach credential values.

After one prototype run, convert the TEMP-only full report into the small,
credential-free assertion shape consumed by both acceptance generators:

```powershell
npm run summarize:browser -- `
  "$env:VAL02B_BROWSER_RESULTS_DIR/playwright-results.json" wagtail
```

The summarizer writes JSON to stdout. It never copies screenshots, videos,
credentials or the full Playwright report into the repository.

- Wagtail reads `VAL02_WAGTAIL_ADMIN_USERNAME` and
  `VAL02_WAGTAIL_ADMIN_PASSWORD` (the provisioner's `VAL02B_ADMIN_PASSWORD` is
  also accepted) plus the emitted review path in `VAL02B_WAGTAIL_REVIEW_PATH`.
- Payload reads `VAL02_PAYLOAD_ADMIN_EMAIL` and
  `VAL02_PAYLOAD_ADMIN_PASSWORD`; set `VAL02B_PAYLOAD_BROWSER_CANDIDATE_ID`
  when the provisioned candidate is not the first option.

The suite emits BG-01 login, BG-02 review and BG-03/BG-04 gallery tests for each
prototype. Small JSON attachments record clicks, navigations, keyboard actions,
duration, console errors, network failures, layout and forbidden/Hpoi attempts.

## Infrastructure status boundary

Compose files are intentionally absent unless an already-running Docker daemon
is available. Docker/Compose presence alone is insufficient. When the daemon,
PostgreSQL client/service and loopback S3 service are unavailable, BG-17 through
BG-29 must be reported as `environment_blocked`, never as passed.
