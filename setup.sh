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
  npm run api
  npm run dev

Then open:
  http://127.0.0.1:5173

To test the production build locally:
  npm run api
  npm run build
  npm start

Then open:
  http://127.0.0.1:2223

Spotify, Audius, and other API-backed features expect a separate API server.
By default this repo proxies /api requests to:
  http://127.0.0.1:3001

If your API lives elsewhere, update:
  VITE_API_BASE_URL

If you want the browser to call an absolute API origin directly instead of the local /api proxy, also set:
  VITE_API

Spotify secrets belong in .env.local, which is gitignored.
Start from:
  .env.local.example

If you want to visualize the native Spotify macOS app through Microphone mode, use:
  ./setup-blackhole.sh
EOF
