#!/usr/bin/env bash

set -euo pipefail

PRINT_ONLY=0

if [[ "${1:-}" == "--print-only" ]]; then
  PRINT_ONLY=1
fi

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "setup-blackhole.sh only supports macOS." >&2
  exit 1
fi

require_command open

run_or_print() {
  if [[ "$PRINT_ONLY" -eq 1 ]]; then
    printf '[print-only] %s\n' "$*"
  else
    "$@"
  fi
}

install_blackhole() {
  require_command brew

  if brew list --cask blackhole-2ch >/dev/null 2>&1; then
    echo "BlackHole 2ch is already installed."
    return
  fi

  echo "Installing BlackHole 2ch via Homebrew..."
  run_or_print brew install --cask blackhole-2ch
}

open_audio_midi_setup() {
  echo "Opening Audio MIDI Setup..."
  run_or_print open -a "Audio MIDI Setup"
}

print_steps() {
  cat <<'EOF'

BlackHole setup guide for KaleidoSync

1. In Audio MIDI Setup, click the + button and create a Multi-Output Device.
2. Enable both:
   - BlackHole 2ch
   - your speakers or headphones
3. Rename it to something obvious, for example:
   KaleidoSync Output
4. In macOS Sound settings, set Output to that Multi-Output Device.
5. In macOS Sound settings, set Input to BlackHole 2ch.
6. Start Spotify and play a track in the native app.
7. Start KaleidoSync:
   - npm run api
   - npm run dev
8. Open http://127.0.0.1:5173 and choose:
   Microphone

Notes

- BlackHole's current Homebrew cask notes that a reboot is required after install.
- If the browser asks for microphone permission, allow it.
- If Chrome or Edge lets you choose an input device, select BlackHole 2ch.
- Loopback is also a good option, but its routing is GUI-driven and licensed, so this script focuses on the free BlackHole path.
EOF
}

install_blackhole
open_audio_midi_setup
print_steps
