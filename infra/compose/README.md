# PR-00 local infrastructure boundary

This Compose project is a disposable, non-production PostgreSQL 16 and S3-compatible test boundary. It does not deploy Figure Gallery and contains no usable credentials.

Create an untracked `infra/compose/.env` from `.env.example`, replace every `replace-with-runtime-*` value, then run from the repository root:

```sh
docker compose --env-file infra/compose/.env -f infra/compose/compose.yml up -d --wait
docker compose --env-file infra/compose/.env -f infra/compose/compose.yml down -v --remove-orphans
```

All published ports bind to `127.0.0.1`. The project uses a standard bridge network because the formal application and its migration process run on the host and must reach those loopback-published ports; the loopback bindings remain the external exposure boundary. The database and bucket are dedicated to this disposable PR-00 environment. `down -v` is the required cleanup command; do not reuse these volumes for durable data.
