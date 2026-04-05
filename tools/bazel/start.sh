#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

cd "$ROOT_DIR"

if [ ! -d node_modules ] || [ ! -f .env ]; then
  echo "Project is not set up yet. Running ./setup.sh..."
  ./setup.sh
fi

if [ ! -d dist ]; then
  echo "Production build missing. Running npm run build..."
  npm run build
fi

exec npm start
