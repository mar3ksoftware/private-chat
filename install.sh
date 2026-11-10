#!/usr/bin/env bash
set -euo pipefail

# ── Scattered Keyhole — one-command setup ───────────────────────────────
# Installs backend (Bun) and frontend (Node/Vite) dependencies,
# then starts both servers.

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Scattered Keyhole Installer ==="
echo ""

# ── 1. Check prerequisites ─────────────────────────────────────────────

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: '$1' is not installed."
    echo "  $2"
    exit 1
  fi
}

check_cmd bun  "Install Bun: curl -fsSL https://bun.sh/install | bash"
check_cmd node "Install Node.js: https://nodejs.org/ (v20+)"
check_cmd npm  "Comes with Node.js"

echo "Prerequisites OK"
echo ""

# ── 2. Install backend dependencies ────────────────────────────────────

echo "Installing backend dependencies..."
(cd "$ROOT/backend" && bun install --frozen-lockfile 2>/dev/null || bun install)
echo ""

# ── 3. Install frontend dependencies ───────────────────────────────────

echo "Installing frontend dependencies..."
(cd "$ROOT/frontend" && npm ci 2>/dev/null || npm install)
echo ""

# ── 4. Start both servers ──────────────────────────────────────────────

echo "=== Starting Scattered Keyhole ==="
echo ""
echo "  Backend:  http://localhost:3000  (health: GET /health)"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."
echo ""

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$BACKEND_PID" 2>/dev/null || true
  kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

# Start backend in background
(cd "$ROOT/backend" && bun run src/index.ts) &
BACKEND_PID=$!

# Start frontend in background
(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

# Wait for either to exit
wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
