#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

require_command node
require_command npm

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"

if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 or newer is required. Found: $(node -v)" >&2
  exit 1
fi

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
else
  echo "Using existing .env"
fi

if [ -f package-lock.json ]; then
  echo "Installing dependencies from package-lock.json..."
  npm ci
else
  echo "Installing dependencies..."
  npm install --no-package-lock
fi

cat <<'EOF'

Setup complete.

Start the development server:
  npm run dev

Then open:
  http://localhost:5173

To test the production build locally:
  npm run build
  npm start

Then open:
  http://localhost:2223

If you created .env from .env.example, update any placeholder values before using API-backed features.
EOF
