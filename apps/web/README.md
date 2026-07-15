# Figure Gallery formal web baseline

`apps/web` is the formal Payload CMS and Next.js application boundary created from the
official `create-payload-app@3.86.0` blank template. PR-00 establishes infrastructure only;
it does not implement Figure Gallery domain collections, candidate ingestion, review,
media lifecycle, search, gallery, or public-read features.

## Runtime baseline

- Node.js `22.x` (`>=22.12.0 <23`) and npm with `package-lock.json`;
- Payload CMS `3.86.0`, Next.js `16.2.10`, React `19.2.7`, and TypeScript;
- PostgreSQL through `@payloadcms/db-postgres@3.86.0`; SQLite is not a runtime option;
- S3-compatible storage through `@payloadcms/storage-s3@3.86.0` in production;
- `.next/standalone` as the production-shaped output.

All direct dependencies are exact pins. Dependency changes require a separate review and
the complete production gate; do not use `npm audit fix` or floating versions.

The PR-00 development-tool pins are stable releases selected for the Node 22 and Next.js
16 baseline and verified together by a clean npm install, typecheck, lint, unit tests, and
production build: TypeScript `5.7.3`, ESLint `9.39.5` with `eslint-config-next` `16.2.10`,
Vitest `4.0.18`, Playwright `1.58.2`, Prettier `3.9.5`, tsx `4.22.4`, and
vite-tsconfig-paths `6.0.5`. The matching React/Node type packages and `cross-env` are also
exactly pinned in `package.json`; prerelease channels are not used.

## Configuration

Copy `.env.example` to an ignored local environment file and provide runtime values. The
server-only schema validates these variables without returning their values:

`NODE_ENV`, `PAYLOAD_SECRET`, `DATABASE_URI`, `PUBLIC_READ_ENABLED`,
`MEDIA_STORAGE_DRIVER`, `MEDIA_LOCAL_ROOT`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, and `BUILD_VERSION`.

`PUBLIC_READ_ENABLED` defaults to `false`. PostgreSQL is mandatory. Production rejects
filesystem media, while non-production may use an ignored local directory. Non-loopback
S3 endpoints must use HTTPS; loopback HTTP is reserved for temporary local/CI services.
No administrator, database, or object-storage credential is embedded in the repository.

## Commands

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run migrate
npm run migrate:status
npm run build
```

Migrations are generated only by the pinned official Payload CLI, reviewed, and run by a
controlled migrator. The application adapter uses `push: false`, does not create databases,
and readiness fails when the checked-in migration set and database history differ.

## Health and production shape

- `GET /api/health/live` checks only the Node process and never queries PostgreSQL or S3.
- `GET /api/health/ready` performs bounded, read-only configuration, PostgreSQL, migration,
  and (when selected) S3 metadata checks. It returns `503` with classified, redacted status
  when a required boundary is unavailable.
- `npm run build` must produce `.next/standalone`; CI starts a clean copy with `node
server.js`, loads the traced Sharp native runtime, and processes a one-pixel in-memory PNG.
  `next dev` is not a production start path.

The only Payload collections in PR-00 are the technical authenticated `users` collection
and a private infrastructure-only `media` upload collection. Both deny anonymous CRUD.
They are not Figure Gallery domain models or the formal media lifecycle.

## Repository boundary

Formal code must not import, execute, package, or read from `research/` or `spikes/` at
runtime. No spike code was copied into this application. Hpoi is manual reference only:
the app, tests, health probes, and tooling must make zero Hpoi requests. Do not add product
features here until a separately authorized PR-01 task.
