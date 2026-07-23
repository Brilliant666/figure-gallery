# Figure Gallery formal web baseline

`apps/web` is the formal Payload CMS and Next.js application boundary created from the
official `create-payload-app@3.86.0` blank template. PR-00 is merged. The current PR-01
Draft candidate adds only the core catalog domain: eight read-only business Collections,
audited catalog commands, a minimal Catalog Operations view, and the first catalog
migration. Candidate ingestion, review, formal media, merge/split/undo, search, gallery,
and public-read features remain unimplemented.

## Runtime baseline

- Node.js `22.x` (`>=22.12.0 <23`) and npm with `package-lock.json`;
- Payload CMS `3.86.0`, Next.js `16.2.11`, React `19.2.7`, and TypeScript;
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

The PR-00 technical authenticated `users` Collection and private infrastructure-only
`media` upload Collection remain unchanged. They are not Figure Gallery domain models or
the formal media lifecycle.

PR-01 adds these business Collections:

- `works`, `characters`, `character-aliases`, and `manufacturers`;
- `figure-prototypes`, `figure-prototype-characters`, and `figure-versions`;
- append-only `operation-logs`.

Authenticated Admin users may list and read them, but generic REST, GraphQL, Local API,
and Admin create/update/delete paths are denied. Formal writes enter through the explicit
`POST /api/admin/catalog/commands` adapter and the PostgreSQL-transactional services in
`src/domain/catalog/`. The custom `/admin/catalog-operations` view calls that command
adapter; it never saves a Collection directly. Every successful mutation records a
non-reversible PR-01 OperationLog in the same transaction.

Payload 3.86.0 supports adapter-wide UUID IDs, but the merged PR-00 technical tables use
serial IDs. PR-01 therefore preserves those technical IDs and adds an immutable, unique
UUID `stableId` to each catalog entity/relation; commands and audit scope expose only the
stable identity. See [the identity decision](../../docs/PR01_IDENTITY_IMPLEMENTATION.md).

The checked-in `20260715_151314_pr01_core_catalog` migration creates the PR-01 tables,
enums, foreign keys, partial unique indexes, and CHECK constraints. Its `down` path is
intended only for an empty/non-production PR-01 test database and returns to the PR-00
schema; final fresh/repeat/down/up/drift results belong to CI evidence, not this README.

## Repository boundary

Formal code must not import, execute, package, or read from `research/` or `spikes/` at
runtime. No spike code was copied into this application. Hpoi is manual reference only:
the app, tests, health probes, and tooling must make zero Hpoi requests. PR-01 must stop
after its core catalog gates; do not add Candidate/Source/Review/media/public features or
start PR-02 without separate authorization.
