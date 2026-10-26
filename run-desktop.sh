#!/usr/bin/env bash
# Launch FaultMesh Desktop UI from workspace root
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR/ui"

# Verify dependencies using lockfile
if [ ! -d "node_modules" ] || [ ! -x "./node_modules/.bin/electron" ]; then
  echo "Dependencies missing or incomplete. Installing via package-lock.json..."
  if [ -f "package-lock.json" ]; then
    npm ci
  else
    npm install
  fi
fi

# Detect whether build is needed:
# If dist/index.html is absent, or if any source file is newer than dist/index.html
NEEDS_BUILD=0
if [ ! -f "dist/index.html" ]; then
  NEEDS_BUILD=1
else
  if [ -n "$(find src index.html package.json -newer dist/index.html 2>/dev/null | head -n 1)" ]; then
    NEEDS_BUILD=1
  fi
fi

if [ "$NEEDS_BUILD" -eq 1 ]; then
  echo "Detected changes in source files. Building desktop UI bundle..."
  npm run build
fi

ELECTRON_BIN="./node_modules/.bin/electron"
if [ ! -x "$ELECTRON_BIN" ]; then
  echo "Error: Electron binary not found at $ELECTRON_BIN" >&2
  echo "Please run 'npm ci' inside the ui/ directory." >&2
  exit 1
fi

echo "Starting FaultMesh Desktop (Terminal Mode)..."
"$ELECTRON_BIN" electron/main.cjs "$@"
