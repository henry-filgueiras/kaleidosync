#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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

compose_cmd=()

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

exec "${compose_cmd[@]}" -f docker-compose.yml "$@"
