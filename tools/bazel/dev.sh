#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

cd "$ROOT_DIR"

if [ ! -d node_modules ] || [ ! -f .env ]; then
  echo "Project is not set up yet. Running ./setup.sh..."
  ./setup.sh
fi

exec npm run dev
