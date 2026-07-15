# Payload production-gate infrastructure spike

This directory contains a disposable, loopback-only PostgreSQL and S3-compatible
storage scaffold for the Payload production gates. It is not a production
deployment and does not initialize or run the Payload application.

The Compose services use only the pinned images requested by the gate:

- `postgres:16.9-bookworm`
- `minio/minio:RELEASE.2025-04-22T22-12-26Z`
- `minio/mc:RELEASE.2025-04-16T18-13-26Z`

## GitHub Actions production gate

`scripts/run-ci-production-gates.sh` is restricted to the disposable Ubuntu
runner workflow in `.github/workflows/payload-production-gates.yml`. It creates
all credentials under `RUNNER_TEMP`, exercises PostgreSQL, MinIO, backup and
restore, an object-prefix backup/purge/restore drill, storage-key prefix-copy
verification, S3 media lifecycle, restored permission attacks, and an
independent empty-database/empty-bucket standalone start/restart, then removes
containers, volumes, generated media, backups, the clean checkout, and runtime
secrets. It must not be used to retry or reconfigure the blocked Windows Docker
Desktop environment.

`scripts/assemble-ci-evidence.py` accepts only small sanitized JSON summaries.
It rejects runtime environment files, database dumps, images, credentials, and
unsafe evidence. A failed run may upload a sanitized diagnostic artifact, but
the workflow's final enforcement step remains failed; only complete,
machine-validated PG-01 through PG-14 evidence can produce a passing result.

No credential is stored in tracked files. The PowerShell helper creates an
ignored `.env` with fresh random passwords and does not print those passwords.
`.env.example` documents names and defaults only; its password values are
deliberately empty and are not valid runtime secrets.

## Prerequisites

- A locally installed and already-running Docker Engine
- Docker Compose v2 (`docker compose`)
- PowerShell 7 or Windows PowerShell 5.1
- Free loopback ports `55432`, `59000`, and `59001`, or unused alternatives set
  in the generated `.env`

Do not install or reconfigure Docker as part of this spike. Do not use cloud or
production credentials.

## Start

Run from this directory:

```powershell
.\scripts\New-RuntimeEnv.ps1
docker compose --env-file .env config --quiet
docker compose --env-file .env up --detach postgres minio
docker compose --env-file .env run --rm minio-init
docker compose --env-file .env ps --all
```

The one-shot `minio-init` command waits for MinIO with a bounded retry loop,
creates the private bucket idempotently, and exits. Re-running it is safe.

Host access is limited to:

- PostgreSQL: `127.0.0.1:${POSTGRES_PORT}` (default `55432`)
- MinIO S3 API: `http://127.0.0.1:${MINIO_API_PORT}` (default `59000`)
- MinIO console: `http://127.0.0.1:${MINIO_CONSOLE_PORT}` (default `59001`)

The Compose network is an explicit bridge so the one-shot MinIO client can
reach the service; every published host port remains bound to loopback and a
non-loopback probe is part of the CI gate. PostgreSQL and MinIO data live only
in disposable named volumes. Derive the application's `DATABASE_URI` and `S3_*`
runtime variables from this runtime `.env`; do not copy secrets into source
files, logs, or test evidence.

## Stop and erase all runtime state

```powershell
docker compose --env-file .env down --volumes --remove-orphans
if ($LASTEXITCODE -ne 0) {
  throw "Compose cleanup failed; keep .env so the same project can be cleaned up safely."
}
$remaining = @(docker compose --env-file .env ps --all --quiet)
if ($LASTEXITCODE -ne 0 -or $remaining.Count -ne 0) {
  throw "Compose resources still exist or could not be verified; keep .env and investigate."
}
Remove-Item -LiteralPath .env
```

`down --volumes` (equivalent to `down -v`) is required so the disposable
PostgreSQL and MinIO volumes do not survive the gate run. Verify that no
containers remain before considering cleanup complete. The code block above
performs that check and deliberately retains `.env` if cleanup cannot be
verified. For a manual check, run:

```powershell
docker compose --env-file .env ps --all
```

Always run that verification before deleting `.env`, or use the same Compose
project name explicitly if later cleanup is necessary.
