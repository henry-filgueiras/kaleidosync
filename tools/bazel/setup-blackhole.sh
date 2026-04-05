#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

cd "$ROOT_DIR"

args=(--ensure-installed --skip-open)

if [[ "${KALEIDOSYNC_BLACKHOLE_PRINT_ONLY:-0}" == "1" ]]; then
  args+=(--print-only)
fi

exec ./setup-blackhole.sh "${args[@]}"
