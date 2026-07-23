#!/usr/bin/env bash

set -euo pipefail

root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fake_bin="$root/bin"
fake_log="$root/docker.log"
runner_temp="$root/runner"
workspace="$root/workspace"
summary="$root/summary.md"
compose_env="$workspace/infra/compose/.env"
compose_file="$workspace/infra/compose/compose.yml"
init_markers="$runner_temp/pr00-init-markers"
cat_markers="$runner_temp/pr01-catalog-markers"
mkdir -p \
  "$fake_bin" \
  "$workspace/infra/compose" \
  "$workspace/apps/web/.runtime" \
  "$init_markers" \
  "$cat_markers" \
  "$runner_temp/pr00-standalone" \
  "$runner_temp/formal-web-summary"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\n" "$*" >>"$FAKE_DOCKER_LOG"' \
  'case "$*" in' \
  '  *" ps --status running --services") exit 0 ;;' \
  '  *" config --quiet") exit 0 ;;' \
  '  *" down -v --remove-orphans") [[ "${FAKE_DOCKER_MODE:-}" == down_nonzero ]] && exit 9; exit 0 ;;' \
  '  "ps -aq --filter "*) [[ "${FAKE_DOCKER_MODE:-}" == residual ]] && printf "container-id\n"; [[ "${FAKE_DOCKER_MODE:-}" == inspect_error ]] && exit 9; exit 0 ;;' \
  '  "volume ls -q --filter "*) [[ "${FAKE_DOCKER_MODE:-}" == residual ]] && printf "volume-id\n"; [[ "${FAKE_DOCKER_MODE:-}" == inspect_error ]] && exit 9; exit 0 ;;' \
  '  "network ls -q --filter "*) [[ "${FAKE_DOCKER_MODE:-}" == residual ]] && printf "network-id\n"; [[ "${FAKE_DOCKER_MODE:-}" == inspect_error ]] && exit 9; exit 0 ;;' \
  'esac' \
  'exit 9' >"$fake_bin/docker"
chmod +x "$fake_bin/docker"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'case "${FAKE_SS_MODE:-}" in' \
  '  listener) printf "LISTEN synthetic\n"; exit 0 ;;' \
  '  error) exit 9 ;;' \
  '  *) exit 0 ;;' \
  'esac' >"$fake_bin/ss"
chmod +x "$fake_bin/ss"

printf 'services: {}\n' >"$compose_file"
write_compose_env() {
  printf 'COMPOSE_PROJECT_NAME=figure-gallery-pr00\n' >"$compose_env"
}
write_compose_env

run_cleanup() {
  env \
    PATH="$fake_bin:$PATH" \
    FAKE_DOCKER_LOG="$fake_log" \
    RUNNER_TEMP="$runner_temp" \
    GITHUB_WORKSPACE="$workspace" \
    GITHUB_STEP_SUMMARY="$summary" \
    COMPOSE_ENV="$compose_env" \
    COMPOSE_FILE="$compose_file" \
    FORMAL_COMPOSE_PROJECT_NAME=figure-gallery-pr00 \
    INIT_MARKERS="$init_markers" \
    CAT_MARKERS="$cat_markers" \
    PR01_CYCLE_DB=synthetic_cycle \
    "$@" \
    bash "$script_root/formal-ci-cleanup.sh"
}

run_cleanup
test ! -e "$compose_env"
test ! -e "$init_markers"
test ! -e "$cat_markers"
test ! -e "$runner_temp/pr00-standalone"
test ! -e "$runner_temp/formal-web-summary"
grep -q 'ps --status running --services' "$fake_log"
! grep -q 'exec -T postgres' "$fake_log"
grep -q 'down -v --remove-orphans' "$fake_log"
grep -q 'Residual containers/volumes/networks: `0/0/0`' "$summary"
grep -q 'Test-port inspection: `pass`' "$summary"

: >"$fake_log"
write_compose_env
run_cleanup FAKE_DOCKER_MODE=down_nonzero >"$root/down-nonzero.log" 2>&1
grep -q 'down -v --remove-orphans' "$fake_log"
grep -q 'cleanup warning:' "$root/down-nonzero.log"

: >"$fake_log"
run_cleanup >"$root/missing-config.log" 2>&1
! grep -q '^compose ' "$fake_log"
grep -q 'compose configuration is absent or incomplete' "$root/missing-config.log"

set +e
write_compose_env
run_cleanup FAKE_DOCKER_MODE=residual >"$root/residual.log" 2>&1
residual_status=$?
set -e
test "$residual_status" -ne 0
grep -q 'residual Compose containers remain' "$root/residual.log"
grep -q 'Residual containers/volumes/networks: `1/1/1`' "$summary"

set +e
write_compose_env
run_cleanup FAKE_SS_MODE=error >"$root/ss-error.log" 2>&1
ss_error_status=$?
set -e
test "$ss_error_status" -ne 0
grep -q 'could not inspect loopback test port' "$root/ss-error.log"

set +e
write_compose_env
run_cleanup FAKE_SS_MODE=listener >"$root/listener.log" 2>&1
listener_status=$?
set -e
test "$listener_status" -ne 0
grep -q 'loopback test port 3000 is still listening' "$root/listener.log"

outside="$root/outside"
mkdir -p "$outside"
set +e
init_markers="$runner_temp/../outside" run_cleanup >"$root/traversal.log" 2>&1
traversal_status=$?
set -e
test "$traversal_status" -ne 0
grep -q 'INIT_MARKERS does not match its fixed runtime path' "$root/traversal.log"
test -d "$outside"

printf 'Formal CI early-failure cleanup smoke passed.\n'
