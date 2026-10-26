#!/usr/bin/env bash
# Launch FaultMesh Desktop UI from workspace root
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR/ui"

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ ! -d "dist" ]; then
  echo "Building desktop UI..."
  npm run build
fi

echo "Starting FaultMesh Desktop (Terminal Mode)..."
npx electron electron/main.cjs "$@"
