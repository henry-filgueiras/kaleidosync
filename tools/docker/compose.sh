#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMP_COMPOSE_FILE=""

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_env_file() {
  local file_path="$1"

  if [ ! -f "$file_path" ]; then
    return 0
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"

    case "$line" in
      "" | \#*)
        continue
        ;;
    esac

    if [[ "$line" != *=* ]]; then
      continue
    fi

    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export }"
    fi

    local key="${line%%=*}"
    local value="${line#*=}"

    key="$(trim "$key")"
    value="$(trim "$value")"

    if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' && ${#value} -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "$key=$value"
  done < "$file_path"
}

cleanup() {
  if [ -n "$TEMP_COMPOSE_FILE" ] && [ -f "$TEMP_COMPOSE_FILE" ]; then
    rm -f "$TEMP_COMPOSE_FILE"
  fi
}

require_docker_daemon() {
  local subcommand="${1:-}"

  case "$subcommand" in
    "" | config | help | version)
      return 0
      ;;
  esac

  if docker info >/dev/null 2>&1; then
    return 0
  fi

  echo "Docker CLI is installed, but no Docker daemon is reachable at /var/run/docker.sock." >&2
  echo "Start a local Docker runtime, then rerun this command." >&2

  if [ "$(uname -s)" = "Darwin" ]; then
    echo >&2
    echo "Common macOS fixes:" >&2
    echo "  Docker Desktop: open -a Docker" >&2
    echo "  OrbStack:       open -a OrbStack" >&2
    echo "  Colima:         colima start" >&2
  fi

  exit 1
}

compose_cmd=()
compose_file="docker-compose.yml"

if docker compose version >/dev/null 2>&1; then
  compose_cmd=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose_cmd=(docker-compose)
else
  echo "Docker Compose is required. Install the Docker Compose plugin or the docker-compose binary." >&2
  exit 1
fi

cd "$ROOT_DIR"

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

load_env_file ".env"
load_env_file ".env.local"

if [ "${compose_cmd[0]}" = "docker" ] && [ "${compose_cmd[1]}" = "compose" ]; then
  TEMP_COMPOSE_FILE="$(mktemp)"
  trap cleanup EXIT
  awk 'NR == 1 && $0 ~ /^version:/ { next } NR == 2 && $0 ~ /^[[:space:]]*$/ { next } { print }' docker-compose.yml > "$TEMP_COMPOSE_FILE"
  compose_file="$TEMP_COMPOSE_FILE"
fi

require_docker_daemon "${1:-}"

if [ -n "$TEMP_COMPOSE_FILE" ]; then
  "${compose_cmd[@]}" -f "$compose_file" "$@"
  exit $?
fi

exec "${compose_cmd[@]}" -f "$compose_file" "$@"
