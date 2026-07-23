#!/usr/bin/env bash

set +e

cleanup_status=0
warnings=()
errors=()
expected_project_name="figure-gallery-pr00"
project_name="${FORMAL_COMPOSE_PROJECT_NAME:-$expected_project_name}"
compose_configured=false
residual_containers="unknown"
residual_volumes="unknown"
residual_networks="unknown"
ports_status="unknown"
compose_environment_status="missing"

warn() {
  warnings+=("$1")
  printf 'cleanup warning: %s\n' "$1" >&2
}

fail_cleanup() {
  cleanup_status=1
  errors+=("$1")
  printf 'cleanup error: %s\n' "$1" >&2
}

normalize_path() {
  realpath -m -- "$1" 2>/dev/null
}

count_lines() {
  awk 'NF { count += 1 } END { print count + 0 }'
}

if [[ "$project_name" != "$expected_project_name" ]]; then
  fail_cleanup "unexpected Compose project name"
  project_name="$expected_project_name"
fi

runner_temp="${RUNNER_TEMP:-}"
workspace="${GITHUB_WORKSPACE:-}"
if [[ -z "$runner_temp" || "$runner_temp" != /* ]]; then
  fail_cleanup "RUNNER_TEMP must be a non-empty absolute path"
  runner_temp=""
else
  runner_temp="$(normalize_path "$runner_temp")"
  [[ -z "$runner_temp" ]] && fail_cleanup "RUNNER_TEMP could not be normalized"
fi
if [[ -z "$workspace" || "$workspace" != /* ]]; then
  fail_cleanup "GITHUB_WORKSPACE must be a non-empty absolute path"
  workspace=""
else
  workspace="$(normalize_path "$workspace")"
  [[ -z "$workspace" ]] && fail_cleanup "GITHUB_WORKSPACE could not be normalized"
fi

allowed_directories=()
if [[ -n "$runner_temp" ]]; then
  allowed_directories+=(
    "$runner_temp/pr00-standalone"
    "$runner_temp/pr00-local-media"
    "$runner_temp/pr00-drift"
    "$runner_temp/pr01-catalog-markers"
    "$runner_temp/pr00-init-markers"
    "$runner_temp/formal-web-summary"
    "$runner_temp/playwright-results"
  )
fi
if [[ -n "$workspace" ]]; then
  allowed_directories+=("$workspace/apps/web/.runtime")
fi

remove_allowed_directory() {
  local target="${1:-}"
  local normalized=""
  [[ -z "$target" ]] && return
  normalized="$(normalize_path "$target")"
  if [[ -z "$normalized" ]]; then
    fail_cleanup "could not normalize cleanup directory"
    return
  fi
  for allowed in "${allowed_directories[@]}"; do
    if [[ "$normalized" == "$allowed" ]]; then
      rm -rf -- "$normalized" || fail_cleanup "failed to remove allowed runtime directory"
      return
    fi
  done
  fail_cleanup "refused to remove unexpected directory"
}

if [[ -n "${INIT_MARKERS:-}" && -n "$runner_temp" ]]; then
  normalized_init_markers="$(normalize_path "$INIT_MARKERS")"
  [[ "$normalized_init_markers" == "$runner_temp/pr00-init-markers" ]] ||
    fail_cleanup "INIT_MARKERS does not match its fixed runtime path"
fi
if [[ -n "${CAT_MARKERS:-}" && -n "$runner_temp" ]]; then
  normalized_cat_markers="$(normalize_path "$CAT_MARKERS")"
  [[ "$normalized_cat_markers" == "$runner_temp/pr01-catalog-markers" ]] ||
    fail_cleanup "CAT_MARKERS does not match its fixed runtime path"
fi

compose_env_path=""
compose_file_path=""
if [[ -n "${COMPOSE_ENV:-}" ]]; then
  compose_env_path="$(normalize_path "$COMPOSE_ENV")"
fi
if [[ -n "${COMPOSE_FILE:-}" ]]; then
  compose_file_path="$(normalize_path "$COMPOSE_FILE")"
fi
if [[ -n "$workspace" ]]; then
  expected_compose_env="$workspace/infra/compose/.env"
  expected_compose_file="$workspace/infra/compose/compose.yml"
  if [[ -n "$compose_env_path" && "$compose_env_path" != "$expected_compose_env" ]]; then
    fail_cleanup "COMPOSE_ENV is outside its fixed workspace path"
    compose_env_path=""
  fi
  if [[ -n "$compose_file_path" && "$compose_file_path" != "$expected_compose_file" ]]; then
    fail_cleanup "COMPOSE_FILE is outside its fixed workspace path"
    compose_file_path=""
  fi
fi

if command -v docker >/dev/null 2>&1; then
  if [[ -n "$compose_env_path" && -n "$compose_file_path" &&
    -f "$compose_env_path" && -f "$compose_file_path" ]]; then
    compose_command=(
      docker compose
      --project-name "$project_name"
      --env-file "$compose_env_path"
      -f "$compose_file_path"
    )
    "${compose_command[@]}" config --quiet >/dev/null 2>&1
    config_status=$?
    if [[ "$config_status" -eq 0 ]]; then
      compose_configured=true
      running_services="$("${compose_command[@]}" ps --status running --services 2>/dev/null)"
      running_status=$?
      if [[ "$running_status" -ne 0 ]]; then
        fail_cleanup "could not inspect running Compose services"
        running_services=""
      fi
      if [[ -n "${PR01_CYCLE_DB:-}" &&
        "$PR01_CYCLE_DB" =~ ^[a-z0-9_]+$ ]] &&
        grep -qx 'postgres' <<<"$running_services"; then
        "${compose_command[@]}" exec -T postgres \
          dropdb --if-exists -f -U figure_gallery --maintenance-db=postgres \
          "$PR01_CYCLE_DB" ||
          warn "cycle database drop failed; disposable volume teardown will continue"
      fi
      "${compose_command[@]}" down -v --remove-orphans ||
        warn "docker compose down returned non-zero; residual resources will decide cleanup status"
    else
      fail_cleanup "Compose configuration exists but is invalid"
    fi
  else
    warn "compose configuration is absent or incomplete; skipping compose commands"
  fi

  container_output="$(
    docker ps -aq --filter "label=com.docker.compose.project=$project_name" 2>/dev/null
  )"
  container_status=$?
  if [[ "$container_status" -ne 0 ]]; then
    fail_cleanup "could not inspect residual containers"
  else
    residual_containers="$(count_lines <<<"$container_output")"
    [[ "$residual_containers" -eq 0 ]] ||
      fail_cleanup "residual Compose containers remain"
  fi

  volume_output="$(
    docker volume ls -q --filter "label=com.docker.compose.project=$project_name" 2>/dev/null
  )"
  volume_status=$?
  if [[ "$volume_status" -ne 0 ]]; then
    fail_cleanup "could not inspect residual volumes"
  else
    residual_volumes="$(count_lines <<<"$volume_output")"
    [[ "$residual_volumes" -eq 0 ]] ||
      fail_cleanup "residual Compose volumes remain"
  fi

  network_output="$(
    docker network ls -q --filter "label=com.docker.compose.project=$project_name" 2>/dev/null
  )"
  network_status=$?
  if [[ "$network_status" -ne 0 ]]; then
    fail_cleanup "could not inspect residual networks"
  else
    residual_networks="$(count_lines <<<"$network_output")"
    [[ "$residual_networks" -eq 0 ]] ||
      fail_cleanup "residual Compose networks remain"
  fi
else
  fail_cleanup "docker is unavailable, so residual Compose resources cannot be verified"
fi

if command -v ss >/dev/null 2>&1; then
  ports_status="pass"
  for port in 3000 33100 55432 59000 59001; do
    listening="$(
      ss -H -ltn "sport = :$port" 2>/dev/null
    )"
    ss_status=$?
    if [[ "$ss_status" -ne 0 ]]; then
      ports_status="fail"
      fail_cleanup "could not inspect loopback test port $port"
    elif [[ -n "$listening" ]]; then
      ports_status="fail"
      fail_cleanup "loopback test port $port is still listening"
    fi
  done
else
  ports_status="fail"
  fail_cleanup "ss is unavailable, so test ports cannot be verified"
fi

if [[ -n "$compose_env_path" ]]; then
  if [[ -n "$workspace" && "$compose_env_path" == "$workspace/infra/compose/.env" ]]; then
    compose_environment_existed=false
    [[ -e "$compose_env_path" ]] && compose_environment_existed=true
    rm -f -- "$compose_env_path" ||
      fail_cleanup "failed to remove Compose environment"
    if [[ -e "$compose_env_path" ]]; then
      compose_environment_status="fail"
      fail_cleanup "Compose environment still exists after cleanup"
    else
      if [[ "$compose_environment_existed" == true ]]; then
        compose_environment_status="removed"
      else
        compose_environment_status="already-absent"
      fi
    fi
  else
    fail_cleanup "refused to remove unexpected Compose environment path"
  fi
fi

for target in "${allowed_directories[@]}"; do
  remove_allowed_directory "$target"
done

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### Formal CI cleanup\n\n'
    printf -- '- Status: `%s`\n' "$([[ "$cleanup_status" -eq 0 ]] && printf pass || printf fail)"
    printf -- '- Compose configured: `%s`\n' "$compose_configured"
    printf -- '- Compose environment: `%s`\n' "$compose_environment_status"
    printf -- '- Residual containers/volumes/networks: `%s/%s/%s`\n' \
      "$residual_containers" "$residual_volumes" "$residual_networks"
    printf -- '- Test-port inspection: `%s`\n' "$ports_status"
    printf -- '- Warnings: `%s`\n' "${#warnings[@]}"
    printf -- '- Errors: `%s`\n' "${#errors[@]}"
  } >>"$GITHUB_STEP_SUMMARY"
fi

exit "$cleanup_status"
