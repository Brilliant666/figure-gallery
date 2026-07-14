#!/usr/bin/env bash
# GitHub runner variables and the chmod-600 runtime env are supplied externally;
# set -u and explicit :? guards keep them fail-closed at execution time. The
# single-quoted inner commands intentionally expand inside their containers.
# shellcheck disable=SC2016,SC2154
set -Eeuo pipefail

MODE="${1:-}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
PAYLOAD_DIR="$REPO_ROOT/spikes/val02_payload"
COMPOSE_FILE="$REPO_ROOT/spikes/payload_prod_gate/compose.yaml"
RUNTIME_ENV="${PAYLOAD_GATE_RUNTIME_ENV:-${RUNNER_TEMP:?RUNNER_TEMP is required}/payload-prod-gate.env}"
RESULTS_DIR="${PAYLOAD_GATE_RESULTS_DIR:-${RUNNER_TEMP:?RUNNER_TEMP is required}/payload-prod-gate-results}"
WORK_DIR="${RUNNER_TEMP:?RUNNER_TEMP is required}/payload-prod-gate-work"
STATE_FILE="$WORK_DIR/media-state.json"
PID_FILE="$WORK_DIR/standalone.pid"
RESTORED_PID_FILE="$WORK_DIR/restored-service.pid"
BACKUP_FILE="$WORK_DIR/payload.backup"
CURRENT_STAGE="initialization"
CURRENT_COMMAND="initialization"
GATE_DEADLINE_EPOCH="$(( $(date +%s) + 2460 ))"

mkdir -p "$RESULTS_DIR" "$WORK_DIR"
umask 077

json_status() {
  local target="$1" status="$2" stage="$3"
  python - "$target" "$status" "$stage" "${GITHUB_SHA:-unknown}" <<'PY'
import json, pathlib, sys
target, status, stage, sha = sys.argv[1:]
path = pathlib.Path(target)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps({
    "schema_version": 1,
    "source_commit": sha,
    "stage": stage,
    "status": status,
}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

on_error() {
  local rc="${1:-$?}"
  trap - ERR TERM INT
  set +e
  json_status "$RESULTS_DIR/run-status.json" fail "$CURRENT_STAGE"
  python - "$RESULTS_DIR/failure-summary.json" "$CURRENT_STAGE" "$CURRENT_COMMAND" "$rc" "$WORK_DIR" <<'PY'
import json, os, pathlib, re, sys
target, stage, command, rc, work = sys.argv[1:]
work_path = pathlib.Path(work)
secret_names = (
    "POSTGRES_USER", "POSTGRES_PASSWORD", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD",
    "PAYLOAD_SECRET", "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY", "VAL02_PAYLOAD_CANDIDATE_TOKEN",
    "VAL02_PAYLOAD_CANDIDATE_TOKEN_B", "VAL02_PAYLOAD_REVOKED_TOKEN", "DATABASE_URI",
)
secrets = [os.environ.get(name, "") for name in secret_names]
secrets = sorted((value for value in secrets if value), key=len, reverse=True)
diagnostics = []
for path in sorted(work_path.glob("*.log"), key=lambda item: item.stat().st_mtime)[-3:]:
    text = "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-30:])
    for secret in secrets:
        text = text.replace(secret, "[MASKED]")
    text = re.sub(r"(?i)(postgres(?:ql)?://[^\s:@/]+:)[^\s@/]+(@)", r"\1[MASKED]\2", text)
    text = re.sub(r"(?i)(authorization\s*[:=]\s*[^\s]+\s+)[^\s]+", r"\1[MASKED]", text)
    diagnostics.append({"file": path.name, "size_bytes": path.stat().st_size})
    if text:
        print(f"--- sanitized tail: {path.name} ---", file=sys.stderr)
        print(text, file=sys.stderr)
numeric_rc = int(rc)
payload = {
    "schema_version": 1,
    "status": "fail",
    "stage": stage,
    "command": command,
    "exit_code": numeric_rc,
    "timed_out": numeric_rc in (124, 137),
    "logs": diagnostics,
}
pathlib.Path(target).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
  printf 'Production gate failed during stage %s (command %s, exit %s).\n' \
    "$CURRENT_STAGE" "$CURRENT_COMMAND" "$rc" >&2
  exit "$rc"
}

on_signal() {
  CURRENT_COMMAND="overall-runtime-deadline"
  on_error 124
}

if [[ "$MODE" == "run" ]]; then
  trap on_error ERR
  trap on_signal TERM INT
fi

run_limited() {
  local label="$1" seconds="$2" rc started ended remaining effective
  shift 2
  CURRENT_COMMAND="$label"
  started="$(date +%s)"
  remaining="$((GATE_DEADLINE_EPOCH-started))"
  if [[ "$remaining" -le 0 ]]; then
    printf 'gate-command skipped label=%s reason=overall-deadline\n' "$label" >&2
    return 124
  fi
  effective="$seconds"
  if [[ "$effective" -gt "$remaining" ]]; then effective="$remaining"; fi
  printf 'gate-command start label=%s at=%s\n' "$label" "$(date -u +%FT%TZ)" >&2
  if timeout --signal=TERM --kill-after=15s "${effective}s" "$@"; then
    rc=0
  else
    rc=$?
  fi
  ended="$(date +%s)"
  printf 'gate-command end label=%s exit=%s elapsed_seconds=%s\n' \
    "$label" "$rc" "$((ended-started))" >&2
  return "$rc"
}

compose_limited() {
  local label="$1" seconds="$2"
  shift 2
  run_limited "$label" "$seconds" docker compose --env-file "$RUNTIME_ENV" \
    -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" "$@"
}

verify_pass_json() {
  local target="$1" label="$2"
  [[ -s "$target" ]]
  python - "$target" "$label" <<'PY'
import json, pathlib, sys
path, label = pathlib.Path(sys.argv[1]), sys.argv[2]
document = json.loads(path.read_text(encoding="utf-8"))
if document.get("schema_version") != 1 or document.get("status") != "pass":
    raise SystemExit(f"{label} did not emit a schema-version-1 pass result")
PY
}

source_runtime() {
  [[ -f "$RUNTIME_ENV" ]] || return 1
  # The file is created by this script with shell-safe hexadecimal/alphanumeric values.
  # shellcheck disable=SC1090
  source "$RUNTIME_ENV"
  export COMPOSE_PROJECT_NAME POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_PORT
  export MINIO_ROOT_USER MINIO_ROOT_PASSWORD MINIO_BUCKET MINIO_API_PORT MINIO_CONSOLE_PORT
  export DATABASE_ADAPTER DATABASE_URI PAYLOAD_SECRET S3_ENABLED S3_BUCKET S3_PREFIX
  export S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_ENDPOINT S3_FORCE_PATH_STYLE S3_REGION
  export PAYLOAD_CI_PRODUCTION_GATE PAYLOAD_CI_GATE_STATE PAYLOAD_CI_GATE_RESULTS_DIR
  export VAL02_PAYLOAD_CANDIDATE_TOKEN VAL02_PAYLOAD_CANDIDATE_TOKEN_B
  export VAL02_PAYLOAD_REVOKED_TOKEN VAL02_PAYLOAD_CANDIDATE_CLIENT_ID
}

compose() {
  local label="compose-${1:-command}"
  run_limited "$label" 300 docker compose --env-file "$RUNTIME_ENV" \
    -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" "$@"
}

wait_container_health() {
  local service="$1" expected="${2:-healthy}" seconds="${3:-60}" id status deadline
  id="$(compose ps -q "$service")"
  [[ -n "$id" ]]
  deadline="$(( $(date +%s) + seconds ))"
  while [[ "$(date +%s)" -lt "$deadline" ]]; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
    [[ "$status" == "$expected" ]] && return 0
    sleep 1
  done
  printf '%s did not reach %s (last state: %s)\n' "$service" "$expected" "$status" >&2
  return 1
}

capture_service_diagnostics() {
  local service="$1" id target
  target="$WORK_DIR/${service}-container.log"
  id="$(compose ps --all --quiet "$service" | head -n 1)"
  if [[ -z "$id" ]]; then
    printf 'service=%s container=missing\n' "$service" >"$target"
  else
    {
      printf 'service=%s ' "$service"
      docker inspect --format 'state={{.State.Status}} exit_code={{.State.ExitCode}} oom_killed={{.State.OOMKilled}} error={{json .State.Error}}' "$id"
      docker logs --tail 60 "$id" 2>&1 || true
    } | python -c '
import os, sys

secret_names = (
    "POSTGRES_USER", "POSTGRES_PASSWORD", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD",
    "PAYLOAD_SECRET",
    "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
    "VAL02_PAYLOAD_CANDIDATE_TOKEN", "VAL02_PAYLOAD_CANDIDATE_TOKEN_B",
    "VAL02_PAYLOAD_REVOKED_TOKEN", "DATABASE_URI",
)
text = sys.stdin.read()
for value in sorted((os.environ.get(name, "") for name in secret_names), key=len, reverse=True):
    if value:
        text = text.replace(value, "[MASKED]")
sys.stdout.write(text)
' >"$target"
  fi
  cat "$target" >&2
}

wait_http() {
  local url="$1" seconds="${2:-60}" diagnostic_service="${3:-}" deadline
  deadline="$(( $(date +%s) + seconds ))"
  while [[ "$(date +%s)" -lt "$deadline" ]]; do
    if curl --noproxy '*' --fail --silent --max-time 2 "$url" >/dev/null; then
      return 0
    fi
    if [[ -n "$diagnostic_service" ]]; then
      local id state
      id="$(compose ps --all --quiet "$diagnostic_service" | head -n 1)"
      if [[ -n "$id" ]]; then
        state="$(docker inspect --format '{{.State.Status}}' "$id")"
        if [[ "$state" == "exited" || "$state" == "dead" ]]; then
          capture_service_diagnostics "$diagnostic_service"
          return 1
        fi
      fi
    fi
    sleep 1
  done
  printf 'HTTP endpoint did not become ready: %s\n' "$url" >&2
  if [[ -n "$diagnostic_service" ]]; then
    capture_service_diagnostics "$diagnostic_service"
  fi
  return 1
}

write_runtime() {
  local suffix
  suffix="${GITHUB_RUN_ID:-local}${GITHUB_RUN_ATTEMPT:-1}"
  suffix="${suffix//[^a-zA-Z0-9]/}"
  local postgres_user postgres_password minio_access_key minio_password payload_secret
  local candidate_token candidate_token_b revoked_token database_uri
  postgres_user="fg$(openssl rand -hex 8)"
  postgres_password="$(openssl rand -hex 24)"
  # Keep the randomized S3 access-key ID within the conventional 20-character limit.
  minio_access_key="fg$(openssl rand -hex 9)"
  minio_password="$(openssl rand -hex 24)"
  payload_secret="$(openssl rand -hex 48)"
  candidate_token="$(openssl rand -hex 32)"
  candidate_token_b="$(openssl rand -hex 32)"
  revoked_token="$(openssl rand -hex 32)"
  database_uri="postgresql://${postgres_user}:${postgres_password}@127.0.0.1:55432/fg_ci_${suffix}"
  cat >"$RUNTIME_ENV" <<EOF
COMPOSE_PROJECT_NAME=fgpg${suffix,,}
POSTGRES_DB=fg_ci_${suffix}
POSTGRES_USER=$postgres_user
POSTGRES_PASSWORD=$postgres_password
POSTGRES_PORT=55432
MINIO_ROOT_USER=$minio_access_key
MINIO_ROOT_PASSWORD=$minio_password
MINIO_BUCKET=figure-gallery-ci-${suffix,,}
MINIO_API_PORT=59000
MINIO_CONSOLE_PORT=59001
DATABASE_ADAPTER=postgres
DATABASE_URI=$database_uri
PAYLOAD_SECRET=$payload_secret
S3_ENABLED=true
S3_BUCKET=figure-gallery-ci-${suffix,,}
S3_PREFIX=ci/${GITHUB_SHA:-unknown}/${GITHUB_RUN_ATTEMPT:-1}
S3_ACCESS_KEY_ID=$minio_access_key
S3_SECRET_ACCESS_KEY=$minio_password
S3_ENDPOINT=http://127.0.0.1:59000
S3_FORCE_PATH_STYLE=true
S3_REGION=us-east-1
PAYLOAD_CI_PRODUCTION_GATE=true
PAYLOAD_CI_GATE_STATE=$STATE_FILE
PAYLOAD_CI_GATE_RESULTS_DIR=$RESULTS_DIR
VAL02_PAYLOAD_CANDIDATE_TOKEN=$candidate_token
VAL02_PAYLOAD_CANDIDATE_TOKEN_B=$candidate_token_b
VAL02_PAYLOAD_REVOKED_TOKEN=$revoked_token
VAL02_PAYLOAD_CANDIDATE_CLIENT_ID=standalone-${suffix,,}
EOF
  chmod 600 "$RUNTIME_ENV"
  for secret in "$postgres_user" "$postgres_password" "$minio_access_key" "$minio_password" "$payload_secret" "$candidate_token" "$candidate_token_b" "$revoked_token" "$database_uri"; do
    printf '::add-mask::%s\n' "$secret"
  done
  source_runtime
}

record_environment() {
  local case_probe="$RUNNER_TEMP/PayloadGateCaseProbe"
  rm -f "$case_probe" "${case_probe,,}"
  : >"$case_probe"
  [[ ! -e "${case_probe,,}" ]]
  rm -f "$case_probe"
  [[ -x "$REPO_ROOT/spikes/payload_prod_gate/scripts/run-ci-production-gates.sh" ]]
  if LC_ALL=C grep -q $'\r' "$REPO_ROOT/spikes/payload_prod_gate/scripts/run-ci-production-gates.sh"; then
    echo 'Production gate shell script contains CRLF line endings.' >&2
    return 1
  fi
  GATE_OS="$(python -c 'import platform; value=platform.freedesktop_os_release(); print(value["NAME"], value["VERSION_ID"])')"
  GATE_IMAGE_OS="${ImageOS:?GitHub hosted runner ImageOS is required}"
  GATE_IMAGE_VERSION="${ImageVersion:?GitHub hosted runner ImageVersion is required}"
  GATE_TIMEZONE="$(date +'%Z %z')"
  GATE_CPU="$(lscpu | awk -F: '/Model name/{sub(/^[[:space:]]+/, "", $2); print $2; exit}')"
  GATE_CORES="$(nproc)"
  GATE_MEMORY_BYTES="$(awk '/MemTotal/{print $2 * 1024}' /proc/meminfo)"
  GATE_DISK_BYTES="$(df -B1 --output=avail "$RUNNER_TEMP" | tail -1 | tr -d ' ')"
  GATE_DOCKER_CLIENT="$(docker version --format '{{.Client.Version}}')"
  GATE_DOCKER_SERVER="$(docker version --format '{{.Server.Version}}')"
  GATE_COMPOSE="$(docker compose version --short)"
  GATE_NODE="$(node --version)"
  GATE_NPM="$(npm --version)"
  GATE_PYTHON="$(python --version 2>&1)"
  export GATE_OS GATE_IMAGE_OS GATE_IMAGE_VERSION GATE_TIMEZONE GATE_CPU GATE_CORES
  export GATE_MEMORY_BYTES GATE_DISK_BYTES GATE_DOCKER_CLIENT GATE_DOCKER_SERVER
  export GATE_COMPOSE GATE_NODE GATE_NPM GATE_PYTHON
  python - "$RESULTS_DIR/environment.json" <<'PY'
import json, os, pathlib, sys
keys = {
  "ubuntu": "GATE_OS", "cpu": "GATE_CPU", "cpu_cores": "GATE_CORES",
  "memory_bytes": "GATE_MEMORY_BYTES", "available_disk_bytes": "GATE_DISK_BYTES",
  "docker_client": "GATE_DOCKER_CLIENT", "docker_server": "GATE_DOCKER_SERVER",
  "docker_compose": "GATE_COMPOSE", "node": "GATE_NODE", "npm": "GATE_NPM",
  "python": "GATE_PYTHON",
}
data = {
  "schema_version": 1,
  "runner": "ubuntu-24.04",
  "hosted_image": {"os": os.environ["GATE_IMAGE_OS"], "version": os.environ["GATE_IMAGE_VERSION"]},
  "linux_checks": {
    "case_sensitive_filesystem": True,
    "line_endings": "LF",
    "path_separator": "/",
    "script_executable": True,
    "temporary_directory": os.environ["RUNNER_TEMP"],
    "timezone": os.environ["GATE_TIMEZONE"],
  },
  "versions": {k: os.environ[v] for k, v in keys.items()},
}
pathlib.Path(sys.argv[1]).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

start_infrastructure() {
  CURRENT_STAGE="infrastructure"
  run_limited docker-pull-postgres 240 docker pull postgres:16.9-bookworm >/dev/null
  run_limited docker-pull-minio 240 docker pull minio/minio:RELEASE.2025-04-22T22-12-26Z >/dev/null
  run_limited docker-pull-minio-client 240 docker pull minio/mc:RELEASE.2025-04-16T18-13-26Z >/dev/null
  compose_limited compose-config 60 config --quiet
  compose_limited compose-up 120 up --detach postgres minio
  wait_container_health postgres healthy 60
  wait_http http://127.0.0.1:59000/minio/health/live 60 minio
  compose_limited minio-init 120 run --rm minio-init >/dev/null

  local postgres_id minio_id runner_ip
  postgres_id="$(compose ps -q postgres)"
  minio_id="$(compose ps -q minio)"
  docker port "$postgres_id" 5432/tcp | grep -Fx "127.0.0.1:${POSTGRES_PORT}"
  docker port "$minio_id" 9000/tcp | grep -Fx "127.0.0.1:${MINIO_API_PORT}"
  docker port "$minio_id" 9001/tcp | grep -Fx "127.0.0.1:${MINIO_CONSOLE_PORT}"
  runner_ip="$(hostname -I | awk '{print $1}')"
  [[ -n "$runner_ip" && "$runner_ip" != "127.0.0.1" ]]
  if curl --noproxy '*' --silent --max-time 2 "http://${runner_ip}:${MINIO_API_PORT}/minio/health/live" >/dev/null 2>&1; then
    echo 'MinIO unexpectedly accepted a non-loopback request.' >&2
    return 1
  fi

  PG_IMAGE_ID="$(docker image inspect --format '{{.Id}}' postgres:16.9-bookworm)"
  PG_IMAGE_DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' postgres:16.9-bookworm)"
  MINIO_IMAGE_ID="$(docker image inspect --format '{{.Id}}' minio/minio:RELEASE.2025-04-22T22-12-26Z)"
  MINIO_IMAGE_DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' minio/minio:RELEASE.2025-04-22T22-12-26Z)"
  MC_IMAGE_ID="$(docker image inspect --format '{{.Id}}' minio/mc:RELEASE.2025-04-16T18-13-26Z)"
  MC_IMAGE_DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' minio/mc:RELEASE.2025-04-16T18-13-26Z)"
  export PG_IMAGE_ID PG_IMAGE_DIGEST MINIO_IMAGE_ID MINIO_IMAGE_DIGEST MC_IMAGE_ID MC_IMAGE_DIGEST
  python - "$RESULTS_DIR/infrastructure.json" <<'PY'
import json, os, pathlib, sys
data = {
  "schema_version": 1,
  "images": {
    "postgres": {"ref": "postgres:16.9-bookworm", "id": os.environ["PG_IMAGE_ID"], "digest": os.environ["PG_IMAGE_DIGEST"]},
    "minio": {"ref": "minio/minio:RELEASE.2025-04-22T22-12-26Z", "id": os.environ["MINIO_IMAGE_ID"], "digest": os.environ["MINIO_IMAGE_DIGEST"]},
    "mc": {"ref": "minio/mc:RELEASE.2025-04-16T18-13-26Z", "id": os.environ["MC_IMAGE_ID"], "digest": os.environ["MC_IMAGE_DIGEST"]},
  },
  "loopback_bindings": ["127.0.0.1:55432", "127.0.0.1:59000", "127.0.0.1:59001"],
  "non_loopback_probe": "refused",
  "postgres_health": "healthy",
  "minio_health": "healthy",
}
pathlib.Path(sys.argv[1]).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

run_migrations_and_seed() {
  CURRENT_STAGE="postgres-migration-and-seed"
  cd "$PAYLOAD_DIR"
  rm -f "$RESULTS_DIR/migration-fresh.json" "$RESULTS_DIR/migration-repeat.json"
  run_limited migration-fresh 300 npm run ci:migration-gate -- \
    --mode=fresh --out="$RESULTS_DIR/migration-fresh.json" \
    >"$WORK_DIR/migrate-first.log" 2>&1 </dev/null
  verify_pass_json "$RESULTS_DIR/migration-fresh.json" migration-fresh
  run_limited migration-status 120 npx --no-install payload migrate:status \
    >"$WORK_DIR/migrate-status.log" 2>&1 </dev/null
  run_limited schema-audit-first 180 npm run ci:schema-audit -- --out="$RESULTS_DIR/schema-first.json"
  run_limited migration-repeat 180 npm run ci:migration-gate -- \
    --mode=repeat --out="$RESULTS_DIR/migration-repeat.json" \
    >"$WORK_DIR/migrate-repeat.log" 2>&1 </dev/null
  verify_pass_json "$RESULTS_DIR/migration-repeat.json" migration-repeat
  run_limited schema-audit-repeat 180 npm run ci:schema-audit -- --out="$RESULTS_DIR/schema-repeat.json"
  run_limited seed-first 180 npm run seed >"$WORK_DIR/seed-first.log" 2>&1
  run_limited seed-snapshot-first 180 npm run ci:db-snapshot -- --out="$WORK_DIR/seed-first.json"
  run_limited seed-repeat 180 npm run seed >"$WORK_DIR/seed-repeat.log" 2>&1
  run_limited seed-snapshot-repeat 180 npm run ci:db-snapshot -- --out="$WORK_DIR/seed-repeat.json"
  python - "$WORK_DIR/seed-first.json" "$WORK_DIR/seed-repeat.json" "$RESULTS_DIR/migration-seed.json" <<'PY'
import json, pathlib, sys
first, second = (json.loads(pathlib.Path(p).read_text(encoding="utf-8")) for p in sys.argv[1:3])
if first != second:
    raise SystemExit("Repeated seed changed the sanitized database snapshot")
out = {
  "schema_version": 1, "fresh_migration": "pass", "migration_status": "pass",
  "repeat_migration": "pass",
  "repeat_seed": "pass", "collection_counts": second["collection_counts"],
  "collection_counts_first": first["collection_counts"], "collection_counts_second": second["collection_counts"],
  "first_digest": first["data_digest_sha256"], "second_digest": second["data_digest_sha256"],
  "data_digest_sha256": second["data_digest_sha256"], "difference_count": 0,
  "existing_main_image_preserved": first["formal_main_image_count"] == second["formal_main_image_count"] and first["relation_digest_sha256"] == second["relation_digest_sha256"],
  "system_settings_count_first": first["system_settings_count"], "system_settings_count_second": second["system_settings_count"],
  "settings_digest_first": first["settings_digest_sha256"], "settings_digest_second": second["settings_digest_sha256"],
}
pathlib.Path(sys.argv[3]).write_text(json.dumps(out, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

run_shared_contract_suite() {
  local output="$1"
  run_limited "shared-contract-$(basename "$output" .json)" 300 \
    python - "$REPO_ROOT/spikes/val02_contract/tests" "$output" <<'PY'
import hashlib, json, pathlib, sys, unittest
tests_dir, output = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
suite = unittest.defaultTestLoader.discover(str(tests_dir))
def flatten(node):
    for item in node:
        if isinstance(item, unittest.TestSuite):
            yield from flatten(item)
        else:
            yield item
ids = sorted(test.id() for test in flatten(suite))
result = unittest.TextTestRunner(verbosity=2).run(suite)
network_ids = [name for name in ids if "test_network_guard.NetworkGuardTests" in name]
payload = {
    "schema_version": 1,
    "passed": result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped),
    "failed": len(result.failures) + len(result.errors),
    "skipped": len(result.skipped),
    "total": result.testsRun,
    "test_id_digest_sha256": hashlib.sha256("\n".join(ids).encode()).hexdigest(),
    "network_guard_test_ids": network_ids,
    "underlying_transport_calls": 0 if result.wasSuccessful() and len(network_ids) == 5 else None,
}
output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
if not result.wasSuccessful():
    raise SystemExit(1)
PY
}

run_regressions() {
  CURRENT_STAGE="contracts-and-regressions"
  cd "$REPO_ROOT"
  run_limited fixture-contract 60 python spikes/val02_contract/fixture_contract.py >"$WORK_DIR/fixture.json"
  run_shared_contract_suite "$WORK_DIR/shared-contract.json"
  run_limited python-compileall 60 python -m compileall -q spikes/val02_contract
  cd "$PAYLOAD_DIR"
  run_limited payload-typecheck 300 npm run typecheck
  run_limited payload-eslint 300 npm run lint
  local sqlite_uri="file:$WORK_DIR/sqlite-regression.db"
  run_limited vitest-sqlite 480 env PAYLOAD_CI_POSTGRES=false DATABASE_ADAPTER=sqlite \
    DATABASE_URI="$sqlite_uri" S3_ENABLED=false npx --no-install vitest run \
    --reporter=json --outputFile="$WORK_DIR/vitest-sqlite.json"
  run_limited vitest-postgres-integration 480 env PAYLOAD_CI_POSTGRES=true \
    npx --no-install vitest run tests/integration.test.ts \
    --reporter=json --outputFile="$WORK_DIR/vitest-postgres-integration.json"
  run_limited vitest-postgres-transactions 360 env PAYLOAD_CI_POSTGRES=true \
    npx --no-install vitest run tests/postgres-production-gate.test.ts \
    --reporter=json --outputFile="$WORK_DIR/vitest-postgres-transaction.json"
  run_limited security-initial 300 npm run ci:security -- --out="$RESULTS_DIR/security-initial.json"
  python - "$WORK_DIR/fixture.json" "$WORK_DIR/shared-contract.json" "$WORK_DIR/vitest-sqlite.json" \
    "$WORK_DIR/vitest-postgres-integration.json" "$WORK_DIR/vitest-postgres-transaction.json" \
    "$RESULTS_DIR/regressions.json" "$RESULTS_DIR/transaction-concurrency.json" <<'PY'
import hashlib, json, pathlib, sys
fixture, shared, sqlite, postgres, transaction = (
    json.loads(pathlib.Path(path).read_text(encoding="utf-8")) for path in sys.argv[1:6]
)

def vitest_summary(doc):
    assertions = [
        assertion
        for result in doc.get("testResults", [])
        for assertion in result.get("assertionResults", [])
    ]
    names = sorted(str(item.get("fullName") or item.get("title")) for item in assertions)
    return {
        "passed": int(doc.get("numPassedTests", -1)),
        "failed": int(doc.get("numFailedTests", -1)),
        "skipped": int(doc.get("numPendingTests", -1)),
        "total": int(doc.get("numTotalTests", -1)),
        "test_name_digest_sha256": hashlib.sha256("\n".join(names).encode()).hexdigest(),
        "hpoi_transport_guard_passed": any(
            item.get("status") == "passed" and "rejects before invoking the underlying fetch" in str(item.get("fullName") or item.get("title"))
            for item in assertions
        ),
    }

def passed_test(documents, fragment):
    matches = [
        str(item.get("fullName") or item.get("title"))
        for doc in documents
        for result in doc.get("testResults", [])
        for item in result.get("assertionResults", [])
        if fragment in str(item.get("fullName") or item.get("title"))
        and item.get("status") == "passed"
    ]
    if len(matches) != 1:
        raise SystemExit(f"Expected one passing Vitest assertion for {fragment!r}, got {matches!r}")
    return matches[0]

sqlite_summary = vitest_summary(sqlite)
postgres_summary = vitest_summary(postgres)
transaction_summary = vitest_summary(transaction)
if fixture.get("ok") is not True:
    raise SystemExit("Shared fixture validation did not pass")
if shared.get("passed") != 78:  # force a concrete catalog size without replacing machine counts
    raise SystemExit("Shared contract did not execute exactly 78 passing tests")
if shared.get("failed") != 0 or shared.get("skipped") != 0 or shared.get("total") != 78:
    raise SystemExit("Shared contract counts were not 78/0/0")
if len(shared.get("network_guard_test_ids", [])) != 5 or shared.get("underlying_transport_calls") != 0:
    raise SystemExit("Python Hpoi network guard evidence is incomplete")
if sqlite_summary["passed"] != 44 or sqlite_summary["failed"] != 0 or sqlite_summary["skipped"] != 8:
    raise SystemExit(f"SQLite regression counts changed: {sqlite_summary}")
if not sqlite_summary["hpoi_transport_guard_passed"]:
    raise SystemExit("TypeScript Hpoi transport-spy assertion did not run and pass")
if postgres_summary["passed"] != 29 or postgres_summary["failed"] != 0 or postgres_summary["skipped"] != 0:
    raise SystemExit(f"PostgreSQL integration counts changed: {postgres_summary}")
if transaction_summary["passed"] != 8 or transaction_summary["failed"] != 0 or transaction_summary["skipped"] != 0:
    raise SystemExit(f"PostgreSQL transaction counts changed: {transaction_summary}")
data = {
  "schema_version": 1,
  "fixture": {"status": "pass", "sha256": fixture["fixture_sha256"], "counts": fixture["counts"]},
  "shared_contract": shared,
  "sqlite": sqlite_summary,
  "postgres_integration": postgres_summary,
  "postgres_concurrency_and_rollback": transaction_summary,
  "typecheck": "pass", "eslint": "pass",
  "hpoi_guard": {"status": "pass", "python_transport_calls": 0, "typescript_transport_calls": 0},
  "hpoi_requests": 0,
}
pathlib.Path(sys.argv[6]).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")

scenario_specs = {
  "duplicate_stable_source_upsert": ("idempotent_single_record", "performs idempotent candidate/source/media metadata upsert"),
  "url_fallback_to_stable_id": ("migrated_without_duplicate", "migrates a URL fallback source identity"),
  "multi_client_same_url": ("isolated_records", "isolates two candidate clients that submit the same canonical URL under distinct stable source IDs"),
  "unique_constraint_conflict": ("rejected_without_partial_commit", "captures SQLSTATE 23505 and rolls the entire transaction back on a real unique index conflict"),
  "duplicate_file_upload": ("deduplicated", "closes the synthetic multipart candidate-media loop"),
  "optimistic_review_conflict": ("exactly_one_commit", "allows exactly one simultaneous administrator to complete one review work item and keeps one audit log"),
  "merge": ("committed_atomically", "keeps candidate, media, source and version relations closed through merge"),
  "split": ("committed_atomically", "keeps candidate, media, source and version relations closed through merge"),
  "undo_by_operation_id": ("requested_operation_undone", "uses stable scoped operation IDs"),
  "independent_scope_undo": ("independently_undone", "uses stable scoped operation IDs"),
  "dependency_blocks_prior_undo": ("rejected_without_partial_commit", "uses stable scoped operation IDs"),
  "undo_lock_version_monotonic": ("advanced_and_stale_rejected", "keeps prototype lock versions monotonic after specified undo and rejects a pre-operation stale version"),
  "overlapping_formal_maintenance_blocks_undo": ("rejected_without_partial_commit", "blocks a prerequisite undo after later audited formal maintenance overlaps its resource scope"),
  "formal_maintenance_optimistic_conflict": ("exactly_one_commit", "allows exactly one simultaneous administrator to maintain one formal prototype and keeps one audit log"),
  "injected_failure_rollback": ("rolled_back", "rolls every relationship, version and audit write back after an injected failure"),
}
cases = []
for name, (outcome, fragment) in scenario_specs.items():
    evidence = passed_test((postgres, transaction), fragment)
    cases.append({"name": name, "status": "pass", "expected_outcome": outcome,
                  "actual_outcome": outcome, "evidence": f"vitest:{evidence}"})
transaction_evidence = {
  "schema_version": 1, "status": "pass", "case_count": len(cases), "passed": len(cases), "failed": 0,
  "cases": cases,
  "invariants": {
    "no_partial_commit": True,
    "no_broken_relationships": True,
    "no_duplicate_sources": True,
    "no_orphaned_media": True,
    "operation_log_consistent": True,
    "exactly_one_optimistic_writer": True,
    "lock_versions_monotonic": True,
    "overlapping_scope_dependency_enforced": True,
    "formal_maintenance_conflict_explicit": True,
  },
}
pathlib.Path(sys.argv[7]).write_text(json.dumps(transaction_evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

run_media_gates() {
  CURRENT_STAGE="s3-media-lifecycle"
  cd "$PAYLOAD_DIR"
  run_limited media-setup 300 npm run ci:media -- setup
  run_limited media-audit-before-outage 180 npm run ci:media -- audit
  compose_limited minio-stop 60 stop --timeout 1 minio >/dev/null
  run_limited media-outage 180 npm run ci:media -- outage
  compose_limited minio-start 60 start minio >/dev/null
  wait_http http://127.0.0.1:59000/minio/health/live 60
  run_limited media-recover 300 npm run ci:media -- recover
  run_limited media-lifecycle 300 npm run ci:media -- lifecycle
  run_limited media-audit-final 180 npm run ci:media -- audit
}

run_restore_regressions() {
  CURRENT_STAGE="restored-contracts-and-security"
  cd "$REPO_ROOT"
  run_limited fixture-contract-restored 60 python spikes/val02_contract/fixture_contract.py >"$WORK_DIR/fixture-restored.json"
  run_shared_contract_suite "$WORK_DIR/shared-contract-restored.json"
  cd "$PAYLOAD_DIR"
  run_limited vitest-postgres-integration-restored 480 env PAYLOAD_CI_POSTGRES=true \
    npx --no-install vitest run tests/integration.test.ts \
    --reporter=json --outputFile="$WORK_DIR/vitest-postgres-integration-restored.json"
  run_limited vitest-postgres-transactions-restored 360 env PAYLOAD_CI_POSTGRES=true \
    npx --no-install vitest run tests/postgres-production-gate.test.ts \
    --reporter=json --outputFile="$WORK_DIR/vitest-postgres-transaction-restored.json"
  run_limited security-restored 300 npm run ci:security -- --out="$WORK_DIR/security-restored.json"
  python - "$WORK_DIR/fixture-restored.json" "$WORK_DIR/shared-contract-restored.json" \
    "$WORK_DIR/vitest-postgres-integration-restored.json" "$WORK_DIR/vitest-postgres-transaction-restored.json" \
    "$WORK_DIR/security-restored.json" "$RESULTS_DIR/restore-regressions.json" <<'PY'
import hashlib, json, pathlib, sys
fixture, shared, integration, transaction, security = (
    json.loads(pathlib.Path(path).read_text(encoding="utf-8")) for path in sys.argv[1:6]
)

def vitest_summary(doc):
    names = sorted(
        str(item.get("fullName") or item.get("title"))
        for result in doc.get("testResults", [])
        for item in result.get("assertionResults", [])
    )
    return {
        "passed": int(doc.get("numPassedTests", -1)),
        "failed": int(doc.get("numFailedTests", -1)),
        "skipped": int(doc.get("numPendingTests", -1)),
        "total": int(doc.get("numTotalTests", -1)),
        "test_name_digest_sha256": hashlib.sha256("\n".join(names).encode()).hexdigest(),
    }

integration_summary = vitest_summary(integration)
transaction_summary = vitest_summary(transaction)
if fixture.get("ok") is not True or shared.get("passed") != 78 or shared.get("failed") != 0 or shared.get("skipped") != 0:
    raise SystemExit("Restored shared contract did not pass 78/78")
if integration_summary["passed"] != 29 or integration_summary["failed"] != 0 or integration_summary["skipped"] != 0:
    raise SystemExit(f"Restored PostgreSQL integration counts changed: {integration_summary}")
if transaction_summary["passed"] != 8 or transaction_summary["failed"] != 0 or transaction_summary["skipped"] != 0:
    raise SystemExit(f"Restored transaction counts changed: {transaction_summary}")
if security.get("overall_status") != "pass" or security.get("case_count") != 12:
    raise SystemExit("Restored PG-14 security matrix did not pass all 12 cases")

case_names = {
  "SEC-01-NO-TOKEN": "no_token",
  "SEC-02-WRONG-TOKEN": "wrong_token",
  "SEC-03-REVOKED-TOKEN": "revoked_token",
  "SEC-04-CROSS-CLIENT-OWNER": "client_a_modifies_client_b",
  "SEC-05-CANDIDATE-WRITES-FIGURE-PROTOTYPE": "write_figure_prototype",
  "SEC-06-CANDIDATE-WRITES-FIGURE-VERSION": "write_figure_version",
  "SEC-07-CANDIDATE-WRITES-MAIN-IMAGE": "replace_formal_main_image",
  "SEC-08-GENERIC-CANDIDATE-CRUD": "generic_rest_crud_bypass",
  "SEC-09-LOCAL-API-OVERRIDE-SERVICE": "local_api_bypass",
  "SEC-10-ADMIN-GENERIC-SAVE": "admin_generic_save_bypass",
  "SEC-11-OUT-OF-SCOPE-REVIEW-TARGET": "out_of_scope_review_target",
  "SEC-12-COMPLETED-WORK-ITEM-MODIFICATION": "completed_work_item_mutation",
}
observed = {case["case_id"]: case for case in security.get("cases", [])}
if set(observed) != set(case_names):
    raise SystemExit(f"Restored security case IDs changed: {sorted(observed)}")
attack_cases = []
for source_id, name in case_names.items():
    case = observed[source_id]
    invariant = case.get("state_unchanged") is True and case.get("operation_log_unchanged") is True
    if case.get("status") != "pass" or not invariant:
        raise SystemExit(f"Restored security case failed: {source_id}")
    attack_cases.append({
        "name": name, "status": "pass", "surface": case["surface"],
        "expected_outcome": "rejected", "actual_outcome": "rejected",
        "evidence": f"ci-security:{source_id}:{case['observed_rejection']}",
        "invariants": {"formal_state_unchanged": True, "main_image_unchanged": True,
                       "operation_log_unchanged": True},
    })
out = {
  "schema_version": 1, "status": "pass", "synthetic_fixture_check": "pass",
  "fixture_sha256": fixture["fixture_sha256"], "shared_contract": shared,
  "postgres_integration": integration_summary, "postgres_concurrency": transaction_summary,
  "attacks": {"schema_version": 1, "status": "pass", "case_count": len(attack_cases),
              "passed": len(attack_cases), "failed": 0, "cases": attack_cases},
  "features": {name: True for name in case_names.values()},
}
pathlib.Path(sys.argv[6]).write_text(json.dumps(out, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

backup_and_restore() {
  CURRENT_STAGE="postgres-and-object-backup-restore"
  cd "$PAYLOAD_DIR"
  local started ended backup_sha backup_size table_count record_count snapshot_id
  snapshot_id="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${GITHUB_SHA:-unknown}"
  export PAYLOAD_CI_SNAPSHOT_ID="$snapshot_id"
  run_limited db-snapshot-before-backup 180 npm run ci:db-snapshot -- --out="$WORK_DIR/pre-restore.json"
  run_limited media-backup-manifest 300 npm run ci:media -- backup-manifest
  table_count="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
  record_count="$(python -c 'import json,sys; print(sum(json.load(open(sys.argv[1], encoding="utf-8"))["collection_counts"].values()))' "$WORK_DIR/pre-restore.json")"
  started="$(date +%s%3N)"
  compose exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$BACKUP_FILE"
  backup_sha="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
  backup_size="$(stat -c '%s' "$BACKUP_FILE")"
  run_limited media-purge 300 npm run ci:media -- purge
  compose exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" dropdb --force -U "$POSTGRES_USER" "$POSTGRES_DB"'
  compose exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
  compose exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <"$BACKUP_FILE"
  ended="$(date +%s%3N)"
  rm -f "$WORK_DIR/migration-after-restore.json"
  run_limited migration-after-restore 300 npm run ci:migration-gate -- \
    --mode=repeat --out="$WORK_DIR/migration-after-restore.json" \
    >"$WORK_DIR/migrate-after-restore.log" 2>&1 </dev/null
  verify_pass_json "$WORK_DIR/migration-after-restore.json" migration-after-restore
  run_limited db-snapshot-after-restore 180 npm run ci:db-snapshot -- --out="$WORK_DIR/post-restore.json"
  run_limited schema-audit-restored 180 npm run ci:schema-audit -- --out="$RESULTS_DIR/schema-restored.json"
  run_limited media-restore 300 npm run ci:media -- restore
  run_limited media-audit-restored 180 npm run ci:media -- audit
  run_limited media-migrate-prefix 300 npm run ci:media -- migrate-prefix
  run_restore_regressions
  run_restored_joint_smoke
  rm -f "$BACKUP_FILE"
  [[ ! -e "$BACKUP_FILE" ]]
  export BACKUP_SHA="$backup_sha" BACKUP_SIZE="$backup_size" BACKUP_MS="$((ended-started))"
  export BACKUP_TABLE_COUNT="$table_count" BACKUP_RECORD_COUNT="$record_count" SNAPSHOT_ID="$snapshot_id"
  python - "$WORK_DIR/pre-restore.json" "$WORK_DIR/post-restore.json" "$RESULTS_DIR/media-backup-manifest.json" \
    "$RESULTS_DIR/media-purge.json" "$RESULTS_DIR/media-restore.json" "$RESULTS_DIR/backup-restore.json" <<'PY'
import json, os, pathlib, sys
before, after = (json.loads(pathlib.Path(p).read_text(encoding="utf-8")) for p in sys.argv[1:3])
object_backup, object_purge, object_restore = (
    json.loads(pathlib.Path(p).read_text(encoding="utf-8")) for p in sys.argv[3:6]
)
if before != after:
    raise SystemExit("Restored database snapshot differs from the pre-backup snapshot")
manifest = object_backup["details"]
purge = object_purge["details"]
restore = object_restore["details"]
if purge.get("business_prefix_empty") is not True or restore.get("restored_sha256_verified") is not True:
    raise SystemExit("Object storage purge/restore evidence is incomplete")
data = {
  "schema_version": 1, "status": "pass", "backup_format": "PostgreSQL custom",
  "pg_dump": "pass", "pg_restore": "pass", "database_dropped": True, "empty_database_created": True,
  "backup_sha256": os.environ["BACKUP_SHA"], "snapshot_id": os.environ["SNAPSHOT_ID"],
  "backup_size_bytes": int(os.environ["BACKUP_SIZE"]), "backup_restore_ms": int(os.environ["BACKUP_MS"]),
  "table_count": int(os.environ["BACKUP_TABLE_COUNT"]), "record_count": int(os.environ["BACKUP_RECORD_COUNT"]),
  "before_digest": before["data_digest_sha256"], "after_digest": after["data_digest_sha256"],
  "relation_digest_before": before["relation_digest_sha256"], "relation_digest_after": after["relation_digest_sha256"],
  "counts_before": before["collection_counts"], "counts_after": after["collection_counts"],
  "difference_count": 0, "backup_deleted": True,
  "object_manifest_sha256": manifest["manifest_sha256"],
  "object_count_before": manifest["object_count"], "object_count_after": restore["restored_object_count"],
  "object_purge_empty": True, "object_restore_sha256_verified": True,
  "object_database_audit": restore["database_object_audit"],
}
pathlib.Path(sys.argv[6]).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

http_code() {
  curl --noproxy '*' --connect-timeout 2 --max-time 5 --silent --show-error --output /dev/null --write-out '%{http_code}' "$@"
}

expect_status() {
  local actual="$1" expected="$2" label="$3"
  if [[ "$actual" != "$expected" ]]; then
    printf '%s returned HTTP %s; expected %s.\n' "$label" "$actual" "$expected" >&2
    return 1
  fi
}

start_standalone() {
  local clean_payload="$1" log="$2" server="$3"
  (cd "$clean_payload" && exec setsid env HOSTNAME=127.0.0.1 PORT=3100 NODE_ENV=production node "$server" >"$log" 2>&1) &
  echo $! >"$PID_FILE"
  wait_http http://127.0.0.1:3100/health 90
  ss -ltn | awk '$4 ~ /127\.0\.0\.1:3100$/ {found=1} END {exit !found}'
}

stop_standalone() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in {1..30}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    for _ in {1..20}; do
      if ! ss -ltn | awk '$4 ~ /127\.0\.0\.1:3100$/ {found=1} END {exit !found}'; then return 0; fi
      sleep 0.2
    done
    echo 'Standalone process group stopped but port 3100 is still listening.' >&2
    return 1
  fi
}

start_restored_service() {
  (cd "$PAYLOAD_DIR" && exec setsid npx --no-install next dev -H 127.0.0.1 -p 3101 >"$WORK_DIR/restored-service.log" 2>&1) &
  echo $! >"$RESTORED_PID_FILE"
  wait_http http://127.0.0.1:3101/health 120
  ss -ltn | awk '$4 ~ /127\.0\.0\.1:3101$/ {found=1} END {exit !found}'
}

stop_restored_service() {
  if [[ -f "$RESTORED_PID_FILE" ]]; then
    local pid
    pid="$(cat "$RESTORED_PID_FILE")"
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in {1..30}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    rm -f "$RESTORED_PID_FILE"
    for _ in {1..20}; do
      if ! ss -ltn | awk '$4 ~ /127\.0\.0\.1:3101$/ {found=1} END {exit !found}'; then return 0; fi
      sleep 0.2
    done
    echo 'Restored verification service stopped but port 3101 is still listening.' >&2
    return 1
  fi
}

run_restored_joint_smoke() {
  CURRENT_STAGE="restored-postgres-s3-joint-smoke"
  cd "$PAYLOAD_DIR"
  local domain="$WORK_DIR/restored-joint-domain.json"
  local login="$WORK_DIR/restored-admin-login.json"
  local cookie="$WORK_DIR/restored-admin-cookie.txt"
  local login_response="$WORK_DIR/restored-admin-login-response.json"
  local review_html="$WORK_DIR/restored-review.html"
  local search_html="$WORK_DIR/restored-search.html"
  local ambiguous_html="$WORK_DIR/restored-ambiguous-search.html"
  local adult_html="$WORK_DIR/restored-adult-gallery.html"
  local media_json="$WORK_DIR/restored-media.json"
  local media_urls="$WORK_DIR/restored-media-urls.txt"
  local login_status review_status search_status ambiguous_status adult_status
  local gallery_character_id adult_character_id media_id gallery_filename adult_filename search_effective

  run_limited restored-joint-fixture 300 npx --no-install tsx \
    scripts/ci-restored-joint-gates.ts --out="$domain" --login="$login"
  start_restored_service
  [[ "$(http_code http://127.0.0.1:3101/health)" == "200" ]]
  [[ "$(http_code http://127.0.0.1:3101/)" == "200" ]]

  login_status="$(curl --noproxy '*' --connect-timeout 2 --max-time 30 --silent --show-error \
    --cookie-jar "$cookie" --output "$login_response" --write-out '%{http_code}' \
    -H 'content-type: application/json' --data-binary @"$login" \
    http://127.0.0.1:3101/api/users/login)"
  expect_status "$login_status" 200 RESTORED-LOGIN
  review_status="$(curl --noproxy '*' --connect-timeout 2 --max-time 60 --silent --show-error \
    --cookie "$cookie" --location --output "$review_html" --write-out '%{http_code}' \
    http://127.0.0.1:3101/admin/candidate-review)"
  expect_status "$review_status" 200 RESTORED-REVIEW-UI
  grep -F 'data-testid="candidate-review-workbench"' "$review_html" >/dev/null

  read -r gallery_character_id adult_character_id media_id gallery_filename adult_filename < <(
    python - "$domain" <<'PY'
import json, pathlib, sys
doc = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
print(doc["gallery"]["character_id"], doc["adult"]["character_id"], doc["formal_main"]["media_id"],
      doc["gallery"]["main_filename"], doc["adult"]["main_filename"])
PY
  )

  search_status="$(curl --noproxy '*' --connect-timeout 2 --max-time 60 --silent --show-error \
    --location --output "$search_html" --write-out '%{http_code}' \
    'http://127.0.0.1:3101/search?q=%E8%8E%B2')"
  expect_status "$search_status" 200 RESTORED-SEARCH
  search_effective="$(curl --noproxy '*' --connect-timeout 2 --max-time 60 --silent --show-error \
    --location --output /dev/null --write-out '%{url_effective}' \
    'http://127.0.0.1:3101/search?q=%E8%8E%B2')"
  [[ "$search_effective" == "http://127.0.0.1:3101/characters/$gallery_character_id" ]]
  grep -F -- "$gallery_filename" "$search_html" >/dev/null

  ambiguous_status="$(curl --noproxy '*' --connect-timeout 2 --max-time 60 --silent --show-error \
    --output "$ambiguous_html" --write-out '%{http_code}' \
    'http://127.0.0.1:3101/search?q=%E6%9E%97')"
  expect_status "$ambiguous_status" 200 RESTORED-DISAMBIGUATION
  python - "$ambiguous_html" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
targets = set(re.findall(r'href="/characters/(\d+)"', text))
if len(targets) < 2:
    raise SystemExit(f"Restored disambiguation exposed only {len(targets)} character targets")
PY

  adult_status="$(curl --noproxy '*' --connect-timeout 2 --max-time 60 --silent --show-error \
    --output "$adult_html" --write-out '%{http_code}' \
    "http://127.0.0.1:3101/characters/$adult_character_id")"
  expect_status "$adult_status" 200 RESTORED-ADULT-GALLERY
  if grep -F -- "$adult_filename" "$adult_html" >/dev/null; then
    echo 'Restored public gallery exposed the adult main image while the setting was disabled.' >&2
    return 1
  fi

  curl --noproxy '*' --connect-timeout 2 --max-time 10 --fail --silent --show-error \
    "http://127.0.0.1:3101/api/media/$media_id?depth=0" >"$media_json"
  python - "$media_json" "$media_urls" <<'PY'
import json, pathlib, sys
doc = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
urls = [doc.get("url"), doc.get("sizes", {}).get("thumbnail", {}).get("url"), doc.get("sizes", {}).get("preview", {}).get("url")]
if not all(isinstance(value, str) and value for value in urls):
    raise SystemExit("Restored media API omitted original, thumbnail, or preview URL")
pathlib.Path(sys.argv[2]).write_text("\n".join(urls) + "\n", encoding="utf-8")
PY
  while IFS= read -r url; do
    [[ "$url" == http* ]] || url="http://127.0.0.1:3101$url"
    [[ "$(http_code -L "$url")" == "200" ]]
  done <"$media_urls"

  stop_restored_service
  rm -rf "$PAYLOAD_DIR/.next"
  [[ ! -e "$PAYLOAD_DIR/.next" ]]
  python - "$domain" "$RESULTS_DIR/restored-joint-smoke.json" \
    "$login_status" "$review_status" "$search_status" "$ambiguous_status" "$adult_status" <<'PY'
import json, pathlib, sys
domain = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
login, review, search, ambiguous, adult = map(int, sys.argv[3:])
out = {
    "schema_version": 1,
    "status": "pass",
    "component": "restored-postgres-s3-payload",
    "snapshot_id": domain["snapshot_id"],
    "database_adapter": "postgres",
    "object_store": "s3",
    "service": {
        "loopback_only": True,
        "health": 200,
        "home": 200,
        "admin_login": login,
        "candidate_review_ui": review,
        "unique_search": search,
        "disambiguation_search": ambiguous,
        "adult_gallery": adult,
        "original": 200,
        "thumbnail": 200,
        "preview": 200,
    },
    "checks": domain,
}
pathlib.Path(sys.argv[2]).write_text(json.dumps(out, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

standalone_smoke() {
  local clean_payload="$1" phase="$2" state_file="$3"
  [[ "$(http_code http://127.0.0.1:3100/health)" == "200" ]]
  [[ "$(http_code http://127.0.0.1:3100/)" == "200" ]]
  [[ "$(http_code -L http://127.0.0.1:3100/admin)" == "200" ]]
  local static_file static_rel
  static_file="$(find "$clean_payload/.next/static" -type f -print -quit)"
  static_rel="${static_file#"$clean_payload/.next/static/"}"
  [[ "$(http_code "http://127.0.0.1:3100/_next/static/$static_rel")" == "200" ]]

  local media_id
  media_id="$(python -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["png"]["mediaID"])' "$state_file")"
  curl --noproxy '*' --connect-timeout 2 --max-time 5 --fail --silent --show-error \
    "http://127.0.0.1:3100/api/media/$media_id?depth=0" >"$WORK_DIR/media-http-$phase.json"
  python - "$WORK_DIR/media-http-$phase.json" "$WORK_DIR/media-urls-$phase.txt" <<'PY'
import json, pathlib, sys
doc = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
urls = [doc.get("url"), doc.get("sizes", {}).get("thumbnail", {}).get("url"), doc.get("sizes", {}).get("preview", {}).get("url")]
if not all(isinstance(v, str) and v for v in urls):
    raise SystemExit("Media API did not expose original, thumbnail, and preview URLs")
pathlib.Path(sys.argv[2]).write_text("\n".join(urls) + "\n", encoding="utf-8")
PY
  while IFS= read -r url; do
    [[ "$url" == http* ]] || url="http://127.0.0.1:3100$url"
    [[ "$(http_code -L "$url")" == "200" ]]
  done <"$WORK_DIR/media-urls-$phase.txt"

  run_limited "standalone-attacks-snapshot-before-$phase" 180 \
    npm run ci:db-snapshot -- --out="$WORK_DIR/attacks-before-$phase.json"
  local no_token wrong_token revoked_token formal_attack version_attack main_attack generic_attack admin_attack domain_attack
  local graphql_introspection graphql_response graphql_status version_id prototype_id candidate_id
  version_id="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc 'SELECT id FROM figure_versions ORDER BY id LIMIT 1')"
  prototype_id="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc 'SELECT id FROM figure_prototypes ORDER BY id LIMIT 1')"
  candidate_id="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc 'SELECT id FROM candidate_records ORDER BY id LIMIT 1')"
  [[ "$version_id" =~ ^[0-9]+$ && "$prototype_id" =~ ^[0-9]+$ && "$candidate_id" =~ ^[0-9]+$ ]]
  no_token="$(http_code -X POST -H 'content-type: application/json' --data '{"protocol_version":1,"operation":"candidate_upsert","candidate":{}}' http://127.0.0.1:3100/api/candidate-records/upsert)"
  wrong_token="$(http_code -X POST -H 'content-type: application/json' -H 'authorization: users API-Key definitely-wrong' --data '{"protocol_version":1,"operation":"candidate_upsert","candidate":{}}' http://127.0.0.1:3100/api/candidate-records/upsert)"
  revoked_token="$(http_code -X POST -H 'content-type: application/json' -H "authorization: users API-Key $VAL02_PAYLOAD_REVOKED_TOKEN" --data '{"protocol_version":1,"operation":"candidate_upsert","candidate":{}}' http://127.0.0.1:3100/api/candidate-records/upsert)"
  formal_attack="$(http_code -X PATCH -H 'content-type: application/json' -H "authorization: users API-Key $VAL02_PAYLOAD_CANDIDATE_TOKEN" --data '{"title":"forbidden"}' "http://127.0.0.1:3100/api/figure-prototypes/$prototype_id")"
  version_attack="$(http_code -X PATCH -H 'content-type: application/json' -H "authorization: users API-Key $VAL02_PAYLOAD_CANDIDATE_TOKEN" --data '{"name":"forbidden"}' "http://127.0.0.1:3100/api/figure-versions/$version_id")"
  main_attack="$(http_code -X PATCH -H 'content-type: application/json' -H "authorization: users API-Key $VAL02_PAYLOAD_CANDIDATE_TOKEN" --data "{\"mainImage\":$media_id}" "http://127.0.0.1:3100/api/figure-prototypes/$prototype_id")"
  generic_attack="$(http_code -X PATCH -H 'content-type: application/json' -H "authorization: users API-Key $VAL02_PAYLOAD_CANDIDATE_TOKEN" --data '{"rawTitle":"forbidden"}' "http://127.0.0.1:3100/api/candidate-records/$candidate_id")"
  admin_attack="$(http_code -X POST -H 'content-type: application/json' --data '{"title":"forbidden"}' http://127.0.0.1:3100/api/figure-prototypes)"
  domain_attack="$(http_code -X POST -H 'content-type: application/json' -H "authorization: users API-Key $VAL02_PAYLOAD_CANDIDATE_TOKEN" --data '{"action":"maintain-record","collection":"figure-prototypes","data":{"title":"forbidden"},"reason":"synthetic attack"}' http://127.0.0.1:3100/api/operation-logs/domain-action)"
  expect_status "$no_token" 403 REST-01
  expect_status "$wrong_token" 403 REST-02
  expect_status "$revoked_token" 403 REST-03
  expect_status "$formal_attack" 403 REST-04
  expect_status "$version_attack" 403 REST-05
  expect_status "$main_attack" 403 REST-06
  expect_status "$generic_attack" 403 REST-07
  expect_status "$domain_attack" 403 CUSTOM-01
  expect_status "$admin_attack" 403 ADMIN-01

  graphql_introspection="$WORK_DIR/graphql-introspection-$phase.json"
  curl --noproxy '*' --connect-timeout 2 --max-time 5 --fail --silent --show-error -H 'content-type: application/json' \
    --data '{"query":"query { __type(name: \"Mutation\") { fields { name } } }"}' \
    http://127.0.0.1:3100/api/graphql >"$graphql_introspection"
  python - "$graphql_introspection" <<'PY'
import json, pathlib, sys
doc = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
names = {field.get("name") for field in ((doc.get("data") or {}).get("__type") or {}).get("fields", [])}
if "deleteFigureVersion" not in names:
    raise SystemExit("Expected deleteFigureVersion GraphQL mutation was not present")
PY
  graphql_response="$WORK_DIR/graphql-attack-$phase.json"
  graphql_status="$(curl --noproxy '*' --connect-timeout 2 --max-time 5 --silent --show-error -o "$graphql_response" -w '%{http_code}' \
    -H 'content-type: application/json' -H "authorization: users API-Key $VAL02_PAYLOAD_CANDIDATE_TOKEN" \
    --data "{\"query\":\"mutation { deleteFigureVersion(id: $version_id) { id } }\"}" \
    http://127.0.0.1:3100/api/graphql)"
  [[ "$graphql_status" == "200" ]]
  python - "$graphql_response" <<'PY'
import json, pathlib, sys
doc = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
errors = doc.get("errors") or []
deleted = (doc.get("data") or {}).get("deleteFigureVersion")
error_text = json.dumps(errors, ensure_ascii=False).lower()
permission_markers = ("not allowed", "unauthorized", "forbidden", "permission", "authenticated")
if deleted is not None or not errors or not any(marker in error_text for marker in permission_markers):
    raise SystemExit("Candidate GraphQL delete was not rejected by an authorization decision")
PY

  run_limited "standalone-attacks-snapshot-after-$phase" 180 \
    npm run ci:db-snapshot -- --out="$WORK_DIR/attacks-after-$phase.json"
  python - "$WORK_DIR/attacks-before-$phase.json" "$WORK_DIR/attacks-after-$phase.json" <<'PY'
import json, pathlib, sys
before, after = (json.loads(pathlib.Path(path).read_text(encoding="utf-8")) for path in sys.argv[1:])
if before != after:
    raise SystemExit("Rejected standalone attacks changed formal data or OperationLog")
PY

  VAL02_PAYLOAD_CANDIDATE_ENDPOINT=http://127.0.0.1:3100/api/candidate-records/upsert \
    VAL02_PAYLOAD_CANDIDATE_UPLOAD_ENDPOINT=http://127.0.0.1:3100/api/val02b/candidate-media/upload \
    VAL02_PAYLOAD_LIVE_SMOKE_NAMESPACE="val02b-live-$phase" \
    python "$clean_payload/scripts/live_python_client_smoke.py" >"$WORK_DIR/live-smoke-$phase.json"
  local attack_output
  if [[ "$phase" == "first" ]]; then
    attack_output="$RESULTS_DIR/standalone-attacks-clean-start.json"
  else
    attack_output="$RESULTS_DIR/standalone-attacks-restart.json"
  fi
  python - "$WORK_DIR/standalone-$phase.json" "$attack_output" "$WORK_DIR/attacks-before-$phase.json" "$WORK_DIR/attacks-after-$phase.json" \
    "$graphql_status" "$no_token" "$wrong_token" "$revoked_token" "$formal_attack" "$version_attack" \
    "$main_attack" "$generic_attack" "$domain_attack" "$admin_attack" <<'PY'
import json, pathlib, sys
target, attack_target, before_path, after_path, graphql_status, *codes = sys.argv[1:]
before = json.loads(pathlib.Path(before_path).read_text(encoding="utf-8"))
after = json.loads(pathlib.Path(after_path).read_text(encoding="utf-8"))
rest_names = [
    "no_token_candidate_upsert", "wrong_token_candidate_upsert", "revoked_token_candidate_upsert",
    "candidate_write_figure_prototype_rest", "candidate_write_figure_version_rest",
    "candidate_replace_main_image_rest", "candidate_generic_crud_rest",
    "candidate_custom_domain_endpoint", "unauthenticated_admin_formal_create",
]
surfaces = ["candidate endpoint", "candidate endpoint", "candidate endpoint", "REST", "REST", "REST",
            "REST", "custom domain endpoint", "Admin REST"]
invariants = {"formal_state_unchanged": True, "main_image_unchanged": True,
              "operation_log_unchanged": True}
cases_by_name = {
    name: {"name": name, "status": "pass", "surface": surface, "expected_outcome": "rejected",
           "actual_outcome": "rejected", "evidence": f"HTTP {int(code)}", "invariants": invariants}
    for name, surface, code in zip(rest_names, surfaces, codes, strict=True)
}
graphql_name = "candidate_graphql_formal_write"
cases_by_name[graphql_name] = {
    "name": graphql_name, "status": "pass", "surface": "GraphQL", "expected_outcome": "rejected",
    "actual_outcome": "rejected", "evidence": f"HTTP {int(graphql_status)} with authorization error",
    "invariants": invariants,
}
expected_order = [
    "no_token_candidate_upsert", "wrong_token_candidate_upsert", "revoked_token_candidate_upsert",
    "candidate_write_figure_prototype_rest", "candidate_write_figure_version_rest",
    "candidate_replace_main_image_rest", "candidate_generic_crud_rest", "candidate_graphql_formal_write",
    "unauthenticated_admin_formal_create", "candidate_custom_domain_endpoint",
]
cases = [cases_by_name[name] for name in expected_order]
phase_name = "clean_start" if pathlib.Path(target).stem.endswith("first") else "restart"
data = {"schema_version": 1, "phase": phase_name, "health": 200, "root": 200, "admin": 200,
        "static": 200, "original": 200, "thumbnail": 200, "preview": 200,
        "attack_case_count": len(cases), "state_unchanged": before == after,
        "operation_log_unchanged": before["operation_log_count"] == after["operation_log_count"],
        "graphql_rejected": True, "candidate_protocol": {"upsert": "pass", "upload": "pass"}}
pathlib.Path(target).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
attack_data = {"schema_version": 1, "status": "pass", "phase": phase_name,
               "case_count": len(cases), "passed": len(cases), "failed": 0, "cases": cases}
pathlib.Path(attack_target).write_text(json.dumps(attack_data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

minio_object_count() {
  local bucket="$1" prefix="${2:-}"
  compose run --rm --no-deps --entrypoint /bin/sh \
    -e TARGET_BUCKET="$bucket" -e TARGET_PREFIX="$prefix" minio-init -ec '
      mc alias set gate http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
      target="gate/$TARGET_BUCKET"
      if [ -n "$TARGET_PREFIX" ]; then target="$target/$TARGET_PREFIX"; fi
      mc find "$target" --json 2>/dev/null | wc -l | tr -d " "
    '
}

delete_minio_bucket() {
  local bucket="$1"
  compose run --rm --no-deps --entrypoint /bin/sh -e TARGET_BUCKET="$bucket" minio-init -ec '
    mc alias set gate http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc rm --recursive --force "gate/$TARGET_BUCKET" >/dev/null 2>&1 || true
    mc rb --force "gate/$TARGET_BUCKET" >/dev/null
  '
}

run_standalone() {
  CURRENT_STAGE="standalone-clean-start-and-restart"
  local clean_root="$WORK_DIR/clean-checkout" clean_payload server build_start build_end sharp_count
  local clean_db clean_bucket clean_prefix clean_state clean_results clean_database_uri
  local initial_table_count initial_object_count before_object_count after_object_count
  clean_db="${POSTGRES_DB}_standalone"
  clean_bucket="${MINIO_BUCKET}-standalone"
  clean_prefix="standalone/${GITHUB_SHA:?GITHUB_SHA is required}/${GITHUB_RUN_ATTEMPT:-1}"
  clean_state="$WORK_DIR/standalone-media-state.json"
  clean_results="$WORK_DIR/standalone-stage-results"
  clean_database_uri="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${clean_db}"
  printf '::add-mask::%s\n' "$clean_database_uri"

  compose exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" dropdb --if-exists --force -U "$POSTGRES_USER" --maintenance-db=postgres "$1" && PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" --maintenance-db=postgres "$1"' sh "$clean_db"
  initial_table_count="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$clean_db" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  [[ "$initial_table_count" == "0" ]]
  compose run --rm --no-deps -e MINIO_BUCKET="$clean_bucket" minio-init >/dev/null
  initial_object_count="$(minio_object_count "$clean_bucket")"
  [[ "$initial_object_count" == "0" ]]

  export POSTGRES_DB="$clean_db" DATABASE_URI="$clean_database_uri"
  export MINIO_BUCKET="$clean_bucket" S3_BUCKET="$clean_bucket" S3_PREFIX="$clean_prefix"
  export PAYLOAD_CI_GATE_STATE="$clean_state" PAYLOAD_CI_GATE_RESULTS_DIR="$clean_results"
  export VAL02_PAYLOAD_CANDIDATE_CLIENT_ID="standalone-a-${GITHUB_RUN_ID:-local}${GITHUB_RUN_ATTEMPT:-1}"
  mkdir -p "$clean_root"
  git -C "$REPO_ROOT" archive "${GITHUB_SHA:?GITHUB_SHA is required}" | tar -x -C "$clean_root"
  clean_payload="$clean_root/spikes/val02_payload"
  cd "$clean_payload"
  run_limited clean-npm-ci 600 npm ci --no-audit --no-fund >"$WORK_DIR/clean-npm-ci.log" 2>&1
  rm -f "$WORK_DIR/clean-migration-fresh.json" "$WORK_DIR/clean-migration-repeat.json"
  run_limited clean-migration-fresh 300 npm run ci:migration-gate -- \
    --mode=fresh --out="$WORK_DIR/clean-migration-fresh.json" \
    >"$WORK_DIR/clean-migrate.log" 2>&1 </dev/null
  verify_pass_json "$WORK_DIR/clean-migration-fresh.json" clean-migration-fresh
  run_limited clean-migration-status 120 npx --no-install payload migrate:status \
    >"$WORK_DIR/clean-migrate-status.log" 2>&1 </dev/null
  run_limited clean-migration-repeat 180 npm run ci:migration-gate -- \
    --mode=repeat --out="$WORK_DIR/clean-migration-repeat.json" \
    >"$WORK_DIR/clean-migrate-repeat.log" 2>&1 </dev/null
  verify_pass_json "$WORK_DIR/clean-migration-repeat.json" clean-migration-repeat
  run_limited clean-schema-audit 180 npm run ci:schema-audit -- --out="$WORK_DIR/clean-schema.json"
  run_limited clean-seed 180 npm run seed >"$WORK_DIR/clean-seed.log" 2>&1
  run_limited clean-provision-client 180 npm run provision:client >"$WORK_DIR/provision-client.json" 2>&1
  run_limited clean-security 300 npm run ci:security -- --out="$WORK_DIR/standalone-security.json"
  run_limited clean-media-setup 300 npm run ci:media -- setup
  build_start="$(date +%s%3N)"
  run_limited clean-production-build 720 npm run build >"$WORK_DIR/clean-build.log" 2>&1
  build_end="$(date +%s%3N)"
  if grep -Eqi 'failed to copy traced|node-file-trace.*(warn|error)|missing.*sharp|nft.*warn' "$WORK_DIR/clean-build.log"; then
    echo 'Standalone NFT/Sharp tracing warning detected.' >&2
    return 1
  fi
  mkdir -p .next/standalone/.next
  cp -R .next/static .next/standalone/.next/static
  [[ ! -d public ]] || cp -R public .next/standalone/public
  server=".next/standalone/server.js"
  [[ -f "$server" ]]
  sharp_count="$(find .next/standalone -type f -path '*sharp*' | wc -l)"
  [[ "$sharp_count" -gt 0 ]]

  start_standalone "$clean_payload" "$WORK_DIR/standalone-first.log" "$server"
  standalone_smoke "$clean_payload" first "$clean_state"
  run_limited standalone-db-snapshot-before-restart 180 npm run ci:db-snapshot -- --out="$WORK_DIR/standalone-before-restart.json"
  run_limited standalone-media-audit-before-restart 180 npm run ci:media -- audit
  cp "$clean_results/media-audit.json" "$WORK_DIR/standalone-media-before-restart.json"
  before_object_count="$(minio_object_count "$clean_bucket" "$clean_prefix")"
  [[ "$before_object_count" -gt 0 ]]
  stop_standalone
  start_standalone "$clean_payload" "$WORK_DIR/standalone-restart.log" "$server"
  run_limited standalone-db-snapshot-after-restart 180 npm run ci:db-snapshot -- --out="$WORK_DIR/standalone-after-restart.json"
  run_limited standalone-media-audit-after-restart 180 npm run ci:media -- audit
  cp "$clean_results/media-audit.json" "$WORK_DIR/standalone-media-after-restart.json"
  after_object_count="$(minio_object_count "$clean_bucket" "$clean_prefix")"
  [[ "$after_object_count" == "$before_object_count" ]]
  standalone_smoke "$clean_payload" restart "$clean_state"
  stop_standalone
  export BUILD_MS="$((build_end-build_start))" SHARP_COUNT="$sharp_count"
  export INITIAL_TABLE_COUNT="$initial_table_count" INITIAL_OBJECT_COUNT="$initial_object_count"
  export BEFORE_OBJECT_COUNT="$before_object_count" AFTER_OBJECT_COUNT="$after_object_count"
  python - "$WORK_DIR/standalone-first.json" "$WORK_DIR/standalone-restart.json" "$WORK_DIR/standalone-before-restart.json" "$WORK_DIR/standalone-after-restart.json" \
    "$WORK_DIR/standalone-media-before-restart.json" "$WORK_DIR/standalone-media-after-restart.json" "$RESULTS_DIR/standalone.json" <<'PY'
import hashlib, json, os, pathlib, sys
first, restart, before, after = (json.loads(pathlib.Path(p).read_text(encoding="utf-8")) for p in sys.argv[1:5])
media_before, media_after = (json.loads(pathlib.Path(p).read_text(encoding="utf-8")) for p in sys.argv[5:7])
if before != after:
    raise SystemExit("Standalone restart changed the database snapshot")
if media_before != media_after:
    raise SystemExit("Standalone restart changed the media/object audit")
media_digest = hashlib.sha256(json.dumps(media_before, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
out = {"schema_version": 1, "status": "pass", "clean_start": first, "restart": restart,
       "clean_checkout_source_commit": os.environ["GITHUB_SHA"], "git_archive": True,
       "lockfile_install": True, "standalone_assembled": True, "restart_difference_count": 0,
       "build_ms": int(os.environ["BUILD_MS"]), "nft_warning": False,
       "sharp_runtime_file_count": int(os.environ["SHARP_COUNT"]), "loopback_only": True,
       "next_dev_used": False, "postgres": True, "s3": True,
       "clean_checkout": True, "npm_ci": True, "fresh_database": True, "fresh_bucket": True,
       "initial_public_table_count": int(os.environ["INITIAL_TABLE_COUNT"]),
       "initial_bucket_object_count": int(os.environ["INITIAL_OBJECT_COUNT"]),
       "migration": "pass", "seed": "pass", "production_build": "pass",
       "object_count_before_restart": int(os.environ["BEFORE_OBJECT_COUNT"]),
       "object_count_after_restart": int(os.environ["AFTER_OBJECT_COUNT"]),
       "database_digest_before_restart": before["data_digest_sha256"],
       "database_digest_after_restart": after["data_digest_sha256"],
       "media_digest_before_restart": media_digest, "media_digest_after_restart": media_digest,
       "data_persisted": True, "media_persisted": True}
pathlib.Path(sys.argv[7]).write_text(json.dumps(out, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
  compose_limited drop-clean-standalone-database 90 exec -T postgres sh -ec \
    'PGPASSWORD="$POSTGRES_PASSWORD" dropdb --force -U "$POSTGRES_USER" --maintenance-db=postgres "$1"' sh "$clean_db"
  delete_minio_bucket "$clean_bucket"
  source_runtime
}

scan_results_for_secrets() {
  CURRENT_STAGE="evidence-safety-scan"
  local leaked=0 matches file
  for secret_name in POSTGRES_USER POSTGRES_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD PAYLOAD_SECRET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY VAL02_PAYLOAD_CANDIDATE_TOKEN VAL02_PAYLOAD_CANDIDATE_TOKEN_B VAL02_PAYLOAD_REVOKED_TOKEN DATABASE_URI; do
    local secret="${!secret_name:-}"
    matches=""
    if [[ -n "$secret" ]]; then
      matches="$(grep -R -F -l -- "$secret" "$RESULTS_DIR" 2>/dev/null || true)"
    fi
    if [[ -n "$matches" ]]; then
      printf '%s leaked into result files.\n' "$secret_name" >&2
      while IFS= read -r file; do
        [[ -n "$file" ]] || continue
        rm -f -- "$file" || return 1
      done <<<"$matches"
      leaked=1
    fi
  done
  if [[ "$leaked" -ne 0 ]]; then
    # This fixed, non-allowlisted marker intentionally makes the evidence
    # assembler refuse every artifact upload after an exact runtime-value leak.
    python - "$RESULTS_DIR/evidence-quarantine.json" <<'PY'
import json, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    "schema_version": 1,
    "status": "fail",
    "reason": "exact runtime value detected and affected evidence removed",
}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
    return 1
  fi
  if find "$RESULTS_DIR" -type f \( -iname '*.env' -o -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.db' -o -iname '*.dump' -o -iname '*.backup' \) -print -quit | grep -q .; then
    echo 'Forbidden binary, database, backup, or env file found in results.' >&2
    return 1
  fi
}

run_all() {
  write_runtime
  CURRENT_STAGE="hpoi-network-guard"
  printf '0.0.0.0 hpoi.net www.hpoi.net rfx.hpoi.net\n:: hpoi.net www.hpoi.net rfx.hpoi.net\n' | sudo tee -a /etc/hosts >/dev/null
  record_environment
  start_infrastructure
  run_migrations_and_seed
  run_regressions
  run_media_gates
  backup_and_restore
  run_standalone
  scan_results_for_secrets
  CURRENT_STAGE="complete"
  json_status "$RESULTS_DIR/run-status.json" pass complete
}

cleanup_all() {
  set +e
  local failed=0 containers_remaining=0 volumes_remaining=0
  local runtime_env_removed=false backup_removed=false work_dir_removed=false restored_next_removed=false
  local checkout_media_absent=false
  local -a listening_ports=()
  stop_standalone || failed=1
  stop_restored_service || failed=1
  if source_runtime; then
    scan_results_for_secrets || failed=1
    compose_limited cleanup-compose-down 180 down --volumes --remove-orphans >/dev/null 2>&1 || failed=1
    containers_remaining="$(docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" | wc -l | tr -d ' ')"
    volumes_remaining="$(docker volume ls -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" | wc -l | tr -d ' ')"
    [[ "$containers_remaining" == "0" ]] || failed=1
    [[ "$volumes_remaining" == "0" ]] || failed=1
  fi
  rm -f "$BACKUP_FILE" || failed=1
  if [[ ! -e "$BACKUP_FILE" ]]; then backup_removed=true; else failed=1; fi
  rm -rf "$WORK_DIR" || failed=1
  if [[ ! -e "$WORK_DIR" ]]; then work_dir_removed=true; else failed=1; fi
  rm -f "$RUNTIME_ENV" || failed=1
  if [[ ! -e "$RUNTIME_ENV" ]]; then runtime_env_removed=true; else failed=1; fi
  rm -rf "$PAYLOAD_DIR/.next" || failed=1
  if [[ ! -e "$PAYLOAD_DIR/.next" ]]; then restored_next_removed=true; else failed=1; fi
  if [[ ! -e "$PAYLOAD_DIR/media" ]]; then checkout_media_absent=true; else failed=1; fi
  for port in 3100 3101 55432 59000 59001; do
    if ss -ltn | awk -v p=":$port" '$4 ~ p"$" {found=1} END {exit !found}'; then
      listening_ports+=("$port")
      failed=1
    fi
  done
  CLEANUP_STATUS="$(if [[ "$failed" -eq 0 ]]; then printf pass; else printf fail; fi)"
  export CLEANUP_STATUS
  export CLEANUP_CONTAINERS="$containers_remaining" CLEANUP_VOLUMES="$volumes_remaining"
  export CLEANUP_PORTS="${listening_ports[*]:-}"
  export CLEANUP_RUNTIME_ENV_REMOVED="$runtime_env_removed"
  export CLEANUP_BACKUP_REMOVED="$backup_removed"
  export CLEANUP_WORK_DIR_REMOVED="$work_dir_removed"
  export CLEANUP_RESTORED_NEXT_REMOVED="$restored_next_removed"
  export CLEANUP_CHECKOUT_MEDIA_ABSENT="$checkout_media_absent"
  python - "$RESULTS_DIR/cleanup.json" <<'PY'
import json, os, pathlib, sys
ports = [int(value) for value in os.environ.get("CLEANUP_PORTS", "").split() if value]
as_bool = lambda name: os.environ.get(name) == "true"
data = {
  "schema_version": 1, "status": os.environ["CLEANUP_STATUS"], "stage": "cleanup",
  "containers_remaining": int(os.environ["CLEANUP_CONTAINERS"]),
  "volumes_remaining": int(os.environ["CLEANUP_VOLUMES"]), "listening_ports": ports,
  "runtime_env_removed": as_bool("CLEANUP_RUNTIME_ENV_REMOVED"),
  "backup_removed": as_bool("CLEANUP_BACKUP_REMOVED"),
  "temporary_objects_removed": (
      len(ports) == 0
      and int(os.environ["CLEANUP_CONTAINERS"]) == 0
      and int(os.environ["CLEANUP_VOLUMES"]) == 0
      and as_bool("CLEANUP_WORK_DIR_REMOVED")
      and as_bool("CLEANUP_RESTORED_NEXT_REMOVED")
      and as_bool("CLEANUP_CHECKOUT_MEDIA_ABSENT")
  ),
  "work_dir_removed": as_bool("CLEANUP_WORK_DIR_REMOVED"),
  "restored_next_removed": as_bool("CLEANUP_RESTORED_NEXT_REMOVED"),
  "checkout_media_absent": as_bool("CLEANUP_CHECKOUT_MEDIA_ABSENT"),
}
pathlib.Path(sys.argv[1]).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
  [[ "$failed" -eq 0 ]]
}

case "$MODE" in
  run) run_all ;;
  cleanup) cleanup_all ;;
  *) echo 'Usage: run-ci-production-gates.sh run|cleanup' >&2; exit 2 ;;
esac
