#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

cd "$ROOT_DIR"

exec ./tools/docker/compose.sh down --remove-orphans
